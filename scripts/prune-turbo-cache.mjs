#!/usr/bin/env node
/**
 * Caps the local Turborepo cache, because Turbo does not.
 *
 * ## The measurement this exists because of (2026-09-21)
 *
 * `.turbo/cache` reached **36 GB in 2742 entries over ten days** — about **3.6 GB/day** of
 * active work — and filled the C: drive to 5.4% free. Turborepo has no TTL and no size cap on
 * its local filesystem cache: every distinct task-input hash writes a new entry and nothing
 * ever removes one. Deleting it by hand fixes one day; at that rate the space comes back in
 * ten.
 *
 * Two things were wrong, and both are worth knowing before changing the number below:
 *
 * 1. **One `web#build` entry was 1.2 GB**, of which ~826 MB was `apps/web/.next/dev` — the
 *    Next.js DEV server's incremental cache, four days stale at the time of measuring and
 *    nothing to do with a production build. `turbo.json` excluded `!.next/cache/**`, which was
 *    correct for Next's old layout; Next now writes the dev cache to `.next/dev/cache`, which
 *    `.next/**` matched happily. Fixed by adding `!.next/dev/**`, so a `web#build` entry should
 *    now be roughly 370 MB rather than 1.2 GB, and the growth rate about a third of what was
 *    measured.
 * 2. **Nothing capped the total.** That is this script.
 *
 * ## What it trades
 *
 * The cache exists to make a repeated task instant. A smaller cap means older hashes fall out
 * and those tasks run cold once — the cost is one rebuild, never a wrong result, because a
 * cache miss is indistinguishable from a first run. The default cap of 5 GB holds roughly a
 * dozen `web#build` entries at the post-fix size plus hundreds of small ones (typecheck, lint,
 * unit tests), which covers the recent work a cache is actually useful for.
 *
 * Override with `TURBO_CACHE_MAX_GB`. Raising it buys more cache hits with disk; lowering it
 * the reverse. Both are fine — the point is that the number is chosen, and that the measured
 * growth rate is written next to it so the trade is visible.
 *
 * ## Usage
 *
 *   node scripts/prune-turbo-cache.mjs          # prune to the cap
 *   node scripts/prune-turbo-cache.mjs --report # measure only, change nothing
 *
 * Oldest entries go first, by mtime. An entry is the three files Turbo writes per hash
 * (`<hash>.tar.zst`, `<hash>-meta.json`, `<hash>-manifest.json`) and they are removed together,
 * so a half-deleted entry can never be served.
 *
 * Safe to run at any time: a pruned entry is a cache miss, and Turbo treats a miss as work to
 * redo. Do not run it DURING a turbo task, though — deleting an entry being written is a
 * pointless race with no upside.
 */
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.turbo', 'cache');
const MAX_GB = Number(process.env.TURBO_CACHE_MAX_GB ?? 5);
const REPORT_ONLY = process.argv.includes('--report');

/** Measured 2026-09-21, for whoever changes MAX_GB. */
const MEASURED = {
  observedTotalGB: 36,
  observedEntries: 2742,
  observedDays: 10,
  growthGBPerDay: 3.6,
  webBuildEntryGBBefore: 1.2,
  webBuildEntryGBAfterDevExclusion: 0.37,
};

const GB = 1024 ** 3;

function entries() {
  let names;
  try {
    names = readdirSync(CACHE_DIR);
  } catch {
    return null; // No cache yet — nothing to do, and not an error.
  }
  /** hash -> { bytes, mtimeMs, files[] } */
  const byHash = new Map();
  for (const name of names) {
    // `<hash>.tar.zst`, `<hash>-meta.json`, `<hash>-manifest.json`
    const hash = name.replace(/\.tar\.zst$/, '').replace(/-(meta|manifest)\.json$/, '');
    const full = join(CACHE_DIR, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // Vanished between readdir and stat; a concurrent prune is not our problem.
    }
    if (!st.isFile()) continue;
    const e = byHash.get(hash) ?? { bytes: 0, mtimeMs: 0, files: [] };
    e.bytes += st.size;
    e.mtimeMs = Math.max(e.mtimeMs, st.mtimeMs);
    e.files.push(full);
    byHash.set(hash, e);
  }
  return byHash;
}

const byHash = entries();
if (byHash === null) {
  console.log('turbo cache: no .turbo/cache directory — nothing to prune.');
  process.exit(0);
}

const all = [...byHash.entries()].map(([hash, e]) => ({ hash, ...e }));
const totalBytes = all.reduce((n, e) => n + e.bytes, 0);
const fmt = (b) => `${(b / GB).toFixed(2)} GB`;

console.log(
  `turbo cache: ${all.length} entries, ${fmt(totalBytes)} (cap ${MAX_GB} GB` +
    `${process.env.TURBO_CACHE_MAX_GB ? ', from TURBO_CACHE_MAX_GB' : ', default'})`,
);

if (all.length > 0) {
  const biggest = [...all].sort((a, b) => b.bytes - a.bytes)[0];
  console.log(`  largest entry: ${fmt(biggest.bytes)} (${biggest.hash})`);
  if (biggest.bytes / GB > MEASURED.webBuildEntryGBAfterDevExclusion * 2) {
    console.log(
      `  NOTE: that is well above the ${MEASURED.webBuildEntryGBAfterDevExclusion} GB a web#build` +
        ` entry should be after the \`!.next/dev/**\` fix. Check turbo.json's \`outputs\` for a` +
        ` directory that does not belong in a build artifact — that is how 826 MB of Next's dev` +
        ` cache ended up in every entry.`,
    );
  }
}

if (totalBytes <= MAX_GB * GB) {
  console.log(`  under the cap by ${fmt(MAX_GB * GB - totalBytes)} — nothing removed.`);
  process.exit(0);
}

// Oldest first: a cache is only useful for recent work, and mtime is what Turbo itself touches.
all.sort((a, b) => a.mtimeMs - b.mtimeMs);

let freed = 0;
let removed = 0;
for (const e of all) {
  if (totalBytes - freed <= MAX_GB * GB) break;
  if (!REPORT_ONLY) for (const f of e.files) rmSync(f, { force: true });
  freed += e.bytes;
  removed += 1;
}

console.log(
  `  ${REPORT_ONLY ? 'WOULD REMOVE' : 'removed'} ${removed} oldest entries, ${fmt(freed)}` +
    ` — leaving ${fmt(totalBytes - freed)}.`,
);
console.log(
  `  for context: measured growth was ~${MEASURED.growthGBPerDay} GB/day before the` +
    ` \`!.next/dev/**\` fix (${MEASURED.observedTotalGB} GB / ${MEASURED.observedEntries} entries` +
    ` / ${MEASURED.observedDays} days).`,
);
