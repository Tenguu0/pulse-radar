# Pulse Radar — momentum-pulse token launch radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Tenguu0/pulse-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Tenguu0/pulse-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Which pre-token protocol is **pulsing** right now? Pulse Radar ranks all 342 pre-token
protocols in the sealed DefiLlama snapshot (2026-11-14, including all 40 on the watchlist)
by the momentum of their TVL — not by a peer multiple.

## The model

```
pulse   = 0.34·momentum + 0.22·heat + 0.20·recency + 0.14·breadth + 0.10·size
implied = min(TVL, P95)^0.65 × (0.35 + 1.65·pulse) × risk × 50
```

- **Momentum** — a logistic curve over the 7-day TVL change (the only growth figure the
  snapshot carries), centred on flat growth.
- **Heat** — the protocol's category median 7-day change against the global median.
- **Recency** — peaks for protocols listed 1–24 months ago; under a month is too new to
  judge, five years with no token is a slower launch story.
- **Breadth** — log share of the chains spanned. **Size** — log share of TVL.
- **Risk** — a haircut (×0.10 CEX, ×0.20 bridges, ×0.30 liquid staking/restaking,
  ×0.5 wrapped/staked names, ×0.6 versioned names, floored at ×0.15). Those are services
  on someone else's token, not a launch of their own — steep on purpose, so sheer size
  alone can never carry an exchange or a bridge to the top of the board.

No protocol name is hardcoded; every number is computed from the snapshot. The board never
claims a token will launch, or when. See the dashboard's **Method** tab for the full story.

## The dashboard

A static, offline page (`dashboard/`, no network):

- **Pre-token board** — sortable (implied value, pulse, TVL, 7-day growth, age, name),
  filterable (search, category, chain, minimum TVL) with **Watchlist only**,
  **Launch-ready only** and **Starred only** toggles (stars persist in localStorage).
- **Detail view** — click any row (or a top-five pulse card) for the pulse dial, the five
  factor bars, a 7-day growth comparison against its category and the field, and a
  five-step farm plan with rough gas cost and duration per step.
- **Already trading** — the 416 protocols whose token already trades, shown at market
  values (market cap, mcap/TVL), never mixed into the model board.
- **Method** — the formula, weights, risk rules and caveats, in plain text.

## Run it

Node 22.18+ (standard library only, no dependencies):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json` (via `buildDossier` from `vendor/makefun-board.ts`).

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes the outputs, checks the board
  against the gate's own rules before writing.
- `lib/pulse.ts` — the momentum-pulse model, the farm-plan generator and the board check.
- `vendor/makefun-board.ts` — the kit's dossier library, verbatim.
- `dashboard/` — `index.html`, `app.css`, `app.js` (the static page).
- `screenshots/` — the board, a protocol detail view and a filtered view.

## License

MIT — see [LICENSE](LICENSE).
