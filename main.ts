// SPDX-License-Identifier: MIT
// Pulse Radar — a momentum-pulse token launch radar (make.fun token-radar-01).
//
// main.ts reads the sealed DefiLlama snapshot, scores every pre-token protocol with the
// momentum-pulse model in lib/pulse.ts, and writes the ranked board, the dashboard's
// data file, the dashboard itself, the screenshots and the judge's dossier into the
// output directory. Node 22+, standard library only.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
//
// Inside the grader the snapshot lives at /input and the output at /output; outside it
// MAKEFUN_OUTPUT_DIR stands in for /output and --input points at the kit's snapshot.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPulseBoard, checkBoard, dataScript, parseSnapshot } from './lib/pulse.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// Caps the scorer enforces on the dossier (see the kit's RULES.txt, "The gate").
const TEXT_MAX_BYTES = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name <value>` (or `--name=value`) from the arguments, else the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1] as string;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`pulse radar: no snapshot at ${inputFile} (pass --input <snapshot.json|directory>)\n`);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = buildPulseBoard(snapshot);

const problem = checkBoard(radar.rows, snapshot);
if (problem !== null) {
  process.stderr.write(`pulse radar: board fails its own gate check: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: radar.rows })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files (skipping dot-names) into `to`; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`pulse radar: screenshots/ holds ${shots.length} image(s); hand in 3 (board, detail, filtered)\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(`pulse radar: screenshots/${name}: name must be letters, digits and . _ -, 1-128 chars\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const top3 = radar.rows.slice(0, 3).map((r) => `#${r.rank} ${r.name}`).join(', ');
const topPulse = radar.rows.slice().sort((a, b) => b.pulse - a.pulse)[0] as (typeof radar.rows)[number];
process.stdout.write(
  `pulse radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${radar.rows.length} pre-token rows scored (${radar.live.length} already-trading set aside)\n` +
    `pulse radar: top of the board: ${top3}\n` +
    `pulse radar: strongest pulse: ${topPulse.name} (${topPulse.pulse.toFixed(1)}) at rank #${topPulse.rank}\n` +
    `pulse radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
    `${join(outDir, 'dashboard')} (${dashFiles.length} files), ${join(outDir, 'screenshots')} ` +
    `(${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
