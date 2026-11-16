// SPDX-License-Identifier: MIT
// Pulse Radar's model: a momentum-pulse score, not a peer multiple.
//
// A protocol's implied launch value here comes from how fast its TVL is moving, how hot
// its category runs against the whole field, how recently it appeared, how many chains it
// spans, and how big it already is — then a risk haircut for products that are unlikely
// to be a launch of their own (exchanges, bridges, wrapped/staked products). No protocol
// name is ever hardcoded: every number below is computed from the sealed snapshot.
//
//   pulse  = 0.34*momentum + 0.22*heat + 0.20*recency + 0.14*breadth + 0.10*size
//   implied = round( min(TVL, P95)^0.65 * (0.35 + 1.65*pulse) * risk * 50 )
//
// TVL is winsorised at the 95th percentile of pre-token TVL before the power is applied,
// so a mega-exchange cannot dominate the board on size alone. Momentum is a logistic
// curve over the 7-day TVL change (the only growth figure the snapshot carries); heat is
// the protocol's category median 7-day change against the global median; recency peaks
// for protocols listed 1-24 months ago; breadth is the log share of chains; size is the
// log share of TVL. Risk multiplies the result down for CEX / bridge / liquid-staking
// categories, versioned names and wrapped/staked names.

export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

export interface PulseFactors {
  momentum: number;
  heat: number;
  recency: number;
  breadth: number;
  size: number;
  risk: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  listed_at: string | null;
  pulse: number;
  factors: PulseFactors;
  category_median_7d: number | null;
  watchlist: boolean;
  launch_ready: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  age_days: number | null;
}

export interface Radar {
  rows: BoardRow[];
  live: LiveRow[];
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols_total: number;
    pre_token_total: number;
    watchlist_total: number;
    global_median_7d: number;
    max_chains: number;
    weights: { momentum: number; heat: number; recency: number; breadth: number; size: number };
  };
}

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: expected { protocols: [], watchlist: [] }');
  }
  if (typeof raw.as_of !== 'string' || typeof raw.floor_usd !== 'number') {
    throw new Error('snapshot: expected as_of and floor_usd');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Array.isArray(p.chains)) {
      throw new Error(`snapshot: protocol ${String(p.slug)} is missing slug, name, tvl_usd or chains`);
    }
  }
  return raw;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

/** Momentum: a logistic curve over the 7-day TVL change, 0..1, centred on flat growth. */
function momentumOf(change7d: number | null): number {
  const g = clamp(change7d ?? 0, -60, 300);
  return 1 / (1 + Math.exp(-g / 40));
}

/**
 * Recency: a protocol listed in the last month is too new to judge (0.55-1.0 ramp), one
 * listed 1-24 months ago sits at the launch window (1.0 down to 0.75), and older listings
 * decay slowly — a five-year-old protocol with no token is a slower launch story.
 */
function recencyOf(age: number | null): number {
  if (age === null) return 0.6;
  if (age < 30) return 0.55 + 0.45 * (age / 30);
  if (age <= 730) return 1 - 0.25 * ((age - 30) / 700);
  return 0.75 * Math.pow(730 / age, 0.35);
}

const RISK_CATEGORIES: Record<string, number> = {
  CEX: 0.1,
  Bridge: 0.2,
  'Canonical Bridge': 0.2,
  'Cross Chain Bridge': 0.2,
  'Liquid Staking': 0.3,
  'Liquid Restaking': 0.3,
  'Restaked BTC': 0.3,
};

/**
 * Risk haircut, 0.15..1.0. An exchange, a bridge or a liquid-staking product is a service
 * on someone else's token, not a launch of its own — so the haircut is steep enough that
 * sheer size cannot carry one to the top of the board; a wrapped/staked name or a
 * versioned name (V2, 2.0) is usually a re-skin of an existing product.
 */
function riskOf(p: SnapProtocol): number {
  let risk = 1;
  if (p.category !== null && RISK_CATEGORIES[p.category] !== undefined) risk *= RISK_CATEGORIES[p.category] as number;
  if (p.category === null) risk *= 0.9;
  const name = p.name.toLowerCase();
  if (/\b(wrapped|staked|staking)\b/.test(name)) risk *= 0.5;
  if (/\s(v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) risk *= 0.6;
  return Math.max(0.15, risk);
}

/** A protocol counts as launch-ready when its risk is clean, it is 1-36 months old and growing. */
function launchReadyOf(p: SnapProtocol, age: number | null, risk: number): boolean {
  return risk >= 0.9 && age !== null && age >= 30 && age <= 1095 && p.change_7d !== null && p.change_7d > 0;
}

// --------------------------------------------------------------------------- farm plans

/** Rough cost of one plain transaction on a chain, in whole dollars, from public fee levels. */
const GAS_USD: Record<string, number> = {
  Ethereum: 3.5,
  Base: 0.08,
  Arbitrum: 0.15,
  Optimism: 0.12,
  'BNB Chain': 0.25,
  BSC: 0.25,
  Polygon: 0.05,
  Solana: 0.01,
  Avalanche: 0.3,
  Blast: 0.05,
  Linea: 0.1,
  Scroll: 0.08,
  'zkSync Era': 0.12,
  Mantle: 0.05,
  Mode: 0.03,
  Fraxtal: 0.05,
  Berachain: 0.1,
  Unichain: 0.08,
  Gnosis: 0.1,
  Fantom: 0.1,
};

function gasUsd(chain: string): string {
  const v = GAS_USD[chain] ?? 0.5;
  return `$${v.toFixed(2)}`;
}

type FarmCtx = { name: string; chain: string; gas: string };

function dexPlan(c: FarmCtx): string[] {
  return [
    `Open ${c.name} on ${c.chain} and connect a fresh wallet holding $100-$300 in stablecoins plus gas; keep this wallet only for this farm so the activity is easy to prove. (Gas ~${c.gas} to set up, 10 min.)`,
    `Swap $25-$75 into the pool's two assets on ${c.name}'s swap page, in 2-3 trades a week apart, so the volume looks organic instead of farmed in a single day. (Gas ~${c.gas} per swap, 5 min each.)`,
    `Add the swapped assets as liquidity in ${c.name}'s main pool and hold the LP position; collect the trading fees while the position stays open. (Gas ~${c.gas}, 10 min to deposit.)`,
    `Return weekly for 4-8 weeks: one small swap or a rebalance of the LP range each visit, and vote if ${c.name} opens a governance poll. (Gas ~${c.gas} per visit, 10 min.)`,
    `Before any snapshot rumour, withdraw half the LP, keep the rest deployed, and save your position history and wallet address as proof of use. (Gas ~${c.gas}, 15 min; total farm time 4-8 weeks.)`,
  ];
}

function lendPlan(c: FarmCtx): string[] {
  return [
    `Supply $100-$300 of a blue-chip asset (ETH, USDC or wBTC) into ${c.name} on ${c.chain} from a dedicated farming wallet; this is your base deposit. (Gas ~${c.gas}, 10 min.)`,
    `Borrow $20-$60 against the deposit at a loan-to-value under 50%, then repay half of it a week later so the account shows real borrow-and-repay activity. (Gas ~${c.gas} per action, 10 min.)`,
    `Leave the supply position open for at least 4 weeks and top it up once with another $25-$50, so the position ages instead of looking like a one-day deposit. (Gas ~${c.gas}, 5 min.)`,
    `Use the borrowed funds inside ${c.name} only - repay into the same market or re-supply - and avoid moving them to another protocol mid-farm. (Gas ~${c.gas}, 10 min.)`,
    `Keep the health factor above 2.0 at all times, then repay the loan fully and withdraw half the supply, leaving the rest supplied as a long-term position. (Gas ~${c.gas}, 15 min; total farm time 4-6 weeks.)`,
  ];
}

function yieldPlan(c: FarmCtx): string[] {
  return [
    `Deposit $100-$250 into ${c.name}'s main vault on ${c.chain} from a dedicated wallet; pick the vault with the largest TVL, not the highest advertised APY. (Gas ~${c.gas}, 10 min.)`,
    `Claim or compound the vault's rewards once a week for 4-6 weeks; weekly compounding shows sustained use and costs less gas than daily claims. (Gas ~${c.gas} per claim, 5 min.)`,
    `Add a second deposit of $25-$50 in week 3 so the position grows over time instead of sitting flat from day one. (Gas ~${c.gas}, 5 min.)`,
    `If ${c.name} offers a second vault or strategy on ${c.chain}, split 20% of the deposit into it to show breadth of use across the product. (Gas ~${c.gas}, 10 min.)`,
    `Withdraw half the position after 6 weeks, keep the rest compounding, and save the deposit and reward transactions as your activity record. (Gas ~${c.gas}, 15 min; total farm time 6 weeks.)`,
  ];
}

function bridgePlan(c: FarmCtx): string[] {
  return [
    `Bridge $50-$150 out of ${c.chain} to another chain ${c.name} supports, using ${c.name}'s own bridge page from a dedicated wallet; start small to test the route. (Gas ~${c.gas} plus the bridge fee, 15-30 min.)`,
    `Bridge back half the amount a week later so the wallet shows two-way volume, not a single one-way transfer that looks farmed. (Gas ~${c.gas} plus fee, 15-30 min.)`,
    `Repeat the round trip once every 1-2 weeks for 4-6 weeks, varying the amount between $25 and $100 each time. (Gas ~${c.gas} per trip, 20 min.)`,
    `Use the bridged funds on the destination chain - a swap or a deposit - instead of bridging straight back within the same hour. (Gas ~${c.gas}, 10 min.)`,
    `Keep total bridged volume above $300 across the farm and save every bridge transaction hash; stop if the bridge fee ever exceeds 2% of the amount. (Gas ~${c.gas}, 10 min; total farm time 4-6 weeks.)`,
  ];
}

function stakePlan(c: FarmCtx): string[] {
  return [
    `Stake $100-$300 of the chain's native asset through ${c.name} on ${c.chain} from a dedicated wallet and receive the liquid staking token it issues. (Gas ~${c.gas}, 10 min.)`,
    `Deploy half the liquid staking token into a lending market or liquidity pool on ${c.chain} so the stake is used, not just held idle. (Gas ~${c.gas}, 10 min.)`,
    `Top up the stake with another $25-$50 in week 3 and restake any rewards ${c.name} pays out, keeping the position growing. (Gas ~${c.gas}, 5 min.)`,
    `Hold the position for at least 6 weeks without unstaking; unstaking early erases the long-term-staker signal the farm is built on. (No gas, just wait.)`,
    `After 6 weeks, unstake a quarter of the position, keep the rest staked, and save the stake and reward transactions as proof. (Gas ~${c.gas}, 15 min; total farm time 6+ weeks.)`,
  ];
}

function rwaPlan(c: FarmCtx): string[] {
  return [
    `Deposit $100-$250 into ${c.name}'s tokenised-asset vault on ${c.chain} from a dedicated wallet; read the vault's terms first, as RWA products often lock funds for a fixed term. (Gas ~${c.gas}, 15 min.)`,
    `Hold the position for the full minimum term ${c.name} states - usually 30-90 days - and do not withdraw early if an early-exit fee applies. (No gas, just wait.)`,
    `Claim any yield ${c.name} distributes monthly and re-deposit it into the same vault to show compounding use. (Gas ~${c.gas} per claim, 5 min.)`,
    `If ${c.name} lists a second asset or vault, allocate 20% of the deposit there in month two to show breadth across its catalogue. (Gas ~${c.gas}, 10 min.)`,
    `At term end, withdraw half, keep the rest invested, and save the deposit, yield and withdrawal records as your activity proof. (Gas ~${c.gas}, 15 min; total farm time 1-3 months.)`,
  ];
}

function derivPlan(c: FarmCtx): string[] {
  return [
    `Open a small $25-$75 perpetual or options position on ${c.name} on ${c.chain} from a dedicated wallet, using 1-2x leverage only; high leverage gets liquidated and ends the farm. (Gas ~${c.gas}, 10 min.)`,
    `Close the position after a few days with a small win or loss, then open a second one the following week; two or three completed trades beat one big trade. (Gas ~${c.gas} per trade, 10 min.)`,
    `Provide $50-$100 of liquidity to ${c.name}'s main market or vault for 4 weeks so the account shows both trading and LP activity. (Gas ~${c.gas}, 10 min.)`,
    `Keep every position under 5% of the wallet's value and never trade during high-volatility news events; a liquidation wipes the activity record. (No gas, just wait.)`,
    `After 4-6 weeks, close the open positions, withdraw the LP, and save the trade history as proof of use. (Gas ~${c.gas}, 15 min; total farm time 4-6 weeks.)`,
  ];
}

function genericPlan(c: FarmCtx): string[] {
  return [
    `Open ${c.name} on ${c.chain} from a dedicated farming wallet funded with $100-$300 plus gas; use this wallet only for ${c.name} so the activity is easy to prove. (Gas ~${c.gas}, 10 min.)`,
    `Make a first real transaction in ${c.name}'s core product - a deposit, swap or stake of $25-$75 - and confirm it settles before doing more. (Gas ~${c.gas}, 10 min.)`,
    `Repeat the core action once a week for 4-6 weeks, varying the amount between $25 and $100 so the pattern looks like genuine use. (Gas ~${c.gas} per week, 10 min.)`,
    `Try a second feature of ${c.name} in week 3 - a different pool, market or tool - so the wallet touches more than one part of the product. (Gas ~${c.gas}, 10 min.)`,
    `After 6 weeks, withdraw or close half the position, keep the rest active, and save every transaction hash as your activity record. (Gas ~${c.gas}, 15 min; total farm time 6 weeks.)`,
  ];
}

const FAMILY: Record<string, (c: FarmCtx) => string[]> = {
  Dexs: dexPlan,
  Lending: lendPlan,
  'Uncollateralized Lending': lendPlan,
  CDP: lendPlan,
  'CDP Manager': lendPlan,
  'Collateral Markets': lendPlan,
  Yield: yieldPlan,
  'Yield Aggregator': yieldPlan,
  'Onchain Capital Allocator': yieldPlan,
  'Risk Curators': yieldPlan,
  'Basis Trading': yieldPlan,
  Bridge: bridgePlan,
  'Canonical Bridge': bridgePlan,
  'Cross Chain Bridge': bridgePlan,
  'Liquid Staking': stakePlan,
  'Liquid Restaking': stakePlan,
  Restaking: stakePlan,
  'Staking Pool': stakePlan,
  RWA: rwaPlan,
  'Anchor BTC': rwaPlan,
  'Decentralized BTC': rwaPlan,
  'Restaked BTC': rwaPlan,
  Derivatives: derivPlan,
  'Options Vault': derivPlan,
  'Leveraged Farming': derivPlan,
  'Interest Rate Derivatives': derivPlan,
  'Prediction Market': derivPlan,
};

function farmPlan(p: SnapProtocol): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const ctx: FarmCtx = { name: p.name, chain, gas: gasUsd(chain) };
  const build = (p.category !== null && FAMILY[p.category]) || genericPlan;
  return build(ctx);
}

// --------------------------------------------------------------------------- the board

const WEIGHTS = { momentum: 0.34, heat: 0.22, recency: 0.2, breadth: 0.14, size: 0.1 };

/** Score every pre-token protocol, rank by implied value, and set the live tab aside. */
export function buildPulseBoard(snapshot: Snapshot): Radar {
  const pre = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null);
  const live = snapshot.protocols.filter((p) => p.gecko_id !== null || p.symbol !== null);
  const watch = new Set(snapshot.watchlist);

  const growths = pre.map((p) => p.change_7d).filter((v): v is number => v !== null);
  const globalMedian = median(growths);

  const byCategory = new Map<string, number[]>();
  for (const p of pre) {
    if (p.category === null || p.change_7d === null) continue;
    const arr = byCategory.get(p.category) ?? [];
    arr.push(p.change_7d);
    byCategory.set(p.category, arr);
  }
  const catMedian = new Map<string, number>();
  for (const [cat, arr] of byCategory) {
    if (arr.length >= 3) catMedian.set(cat, median(arr));
  }

  const maxChains = Math.max(1, ...pre.map((p) => p.chains.length));
  const maxTvl = Math.max(...pre.map((p) => p.tvl_usd));
  const logTop = Math.log10(maxTvl);
  const logFloor = Math.log10(5_000_000);
  // Winsorised TVL: the 95th percentile of pre-token TVL, so mega-exchanges cannot
  // dominate the board on size alone.
  const sortedTvl = pre.map((p) => p.tvl_usd).sort((a, b) => a - b);
  const winsorCap = sortedTvl[Math.floor(0.95 * (sortedTvl.length - 1))] as number;

  const rows: BoardRow[] = pre.map((p) => {
    const age = ageDays(p.listed_at, snapshot.as_of);
    const catMed = p.category !== null ? (catMedian.get(p.category) ?? globalMedian) : globalMedian;
    const factors: PulseFactors = {
      momentum: momentumOf(p.change_7d),
      heat: clamp((catMed - globalMedian + 40) / 120, 0, 1),
      recency: recencyOf(age),
      breadth: Math.log1p(p.chains.length) / Math.log1p(maxChains),
      size: clamp((Math.log10(p.tvl_usd) - logFloor) / (logTop - logFloor), 0, 1),
      risk: riskOf(p),
    };
    const pulse01 =
      WEIGHTS.momentum * factors.momentum +
      WEIGHTS.heat * factors.heat +
      WEIGHTS.recency * factors.recency +
      WEIGHTS.breadth * factors.breadth +
      WEIGHTS.size * factors.size;
    const implied = Math.max(
      1,
      Math.round(Math.pow(Math.min(p.tvl_usd, winsorCap), 0.65) * (0.35 + 1.65 * pulse01) * factors.risk * 50),
    );
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmPlan(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      listed_at: p.listed_at,
      pulse: Math.round(pulse01 * 1000) / 10,
      factors,
      category_median_7d: Math.round(catMed * 100) / 100,
      watchlist: watch.has(p.slug),
      launch_ready: launchReadyOf(p, age, factors.risk),
    };
  });

  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    if (i > 0 && r.implied_value_usd >= (rows[i - 1] as BoardRow).implied_value_usd) {
      r.implied_value_usd = Math.max(1, (rows[i - 1] as BoardRow).implied_value_usd - 1);
    }
  });

  const liveRows: LiveRow[] = live
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      age_days: ageDays(p.listed_at, snapshot.as_of),
    }))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || a.slug.localeCompare(b.slug));

  return {
    rows,
    live: liveRows,
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols_total: snapshot.protocols.length,
      pre_token_total: pre.length,
      watchlist_total: snapshot.watchlist.length,
      global_median_7d: Math.round(globalMedian * 100) / 100,
      max_chains: maxChains,
      weights: WEIGHTS,
    },
  };
}

/** The gate's own board rules, checked before anything is written. Returns the first problem or null. */
export function checkBoard(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, need 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allSame = true;
  let first = -1;
  for (const r of rows) {
    if (!slugs.has(r.slug)) return `row ${r.slug} is not a snapshot protocol`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `row ${r.slug} has no name`;
    if (!Number.isInteger(r.rank) || r.rank < 1) return `row ${r.slug} has rank ${r.rank}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) {
      return `row ${r.slug} has implied_value_usd ${r.implied_value_usd}`;
    }
    if (first < 0) first = r.implied_value_usd;
    if (r.implied_value_usd !== first) allSame = false;
    if (r.implied_value_usd > prev) return `implied value rises at rank ${r.rank}`;
    prev = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps.length} farm steps, need 3-12`;
    }
    for (const s of r.farm_steps) {
      if (typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600) {
        return `row ${r.slug} has a farm step of ${s.trim().length} chars, need 20-600`;
      }
    }
  }
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `ranks are not exactly 1..${rows.length}`;
  }
  if (allSame && rows.length >= 2) return 'all implied values are equal: not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: one global, no network, same snapshot for every run. */
export function dataScript(radar: Radar): string {
  // The dashboard must name no network address: the snapshot's own source string carries
  // the fetch URL, so the data file carries the endpoint's name instead of the URL.
  const clean: Radar = {
    ...radar,
    meta: { ...radar.meta, source: 'DefiLlama protocols API, fetched 2026-11-14' },
  };
  return `window.RADAR = ${JSON.stringify(clean)};\n`;
}
