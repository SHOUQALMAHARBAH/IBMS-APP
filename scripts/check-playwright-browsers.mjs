#!/usr/bin/env node
/**
 * Every Playwright browser on disk must be a revision the INSTALLED playwright-core can use.
 *
 * ## Why this exists
 *
 * Playwright resolves a browser by its revision directory — `chromium-1234`, not "chromium".
 * Bump `@playwright/test` and the new version wants a new revision, downloads it, and **leaves
 * the old one on disk forever**. Nothing notices, because nothing was looking: the tests pass
 * (the new revision is there) and the old directory is simply unreachable weight.
 *
 * Measured on this machine, 2026-09-21, while clearing a full disk: playwright-core **1.62.1**
 * wants chromium 1234 / firefox 1538 / webkit 2336, and on disk were chromium 1234 AND 1243,
 * firefox 1543, webkit 2359. **1.21 GB of browsers this install could never launch** — three
 * silently orphaned by an earlier version bump, exactly as the question predicts.
 *
 * ## What it asserts, and what it deliberately does not
 *
 * ASSERTS: nothing on disk is a revision this playwright-core cannot resolve. That is the
 * failure mode with no other witness, and the fix is one `rm -rf` the output names for you.
 *
 * DOES NOT assert that every default browser is present. This repo installs a SUBSET on purpose
 * — `apps/web/playwright.config.ts` declares a single `chromium` project, and CI runs
 * `npx playwright install --with-deps chromium`. Demanding firefox and webkit would fail an
 * install that is correct, and would invite someone to download 500 MB to silence it. Missing
 * browsers are therefore reported as information, never as a failure.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function browsersRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  }
  return join(homedir(), '.cache', 'ms-playwright');
}

function dirSizeBytes(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let items;
    try {
      items = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      const full = join(cur, it.name);
      if (it.isDirectory()) stack.push(full);
      else {
        try {
          total += statSync(full).size;
        } catch {
          /* raced with a delete; not this check's business */
        }
      }
    }
  }
  return total;
}

const corePkg = require(join(ROOT, 'node_modules', 'playwright-core', 'package.json'));
const registry = require(join(ROOT, 'node_modules', 'playwright-core', 'browsers.json'));

/** name -> revision this playwright-core resolves. */
const wanted = new Map(registry.browsers.map((b) => [b.name, String(b.revision)]));

const root = browsersRoot();
let onDisk;
try {
  onDisk = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);
} catch {
  console.log(`playwright browsers: no cache directory at ${root} — nothing to check.`);
  process.exit(0);
}

const MB = 1024 * 1024;
const orphans = [];
const matched = [];

for (const dir of onDisk) {
  // `<name>-<revision>`, where the name itself may contain hyphens
  // (chromium-headless-shell, chromium-tip-of-tree). Split on the LAST hyphen.
  const idx = dir.lastIndexOf('-');
  if (idx < 0) continue;
  const rev = dir.slice(idx + 1);
  if (!/^\d+$/.test(rev)) continue;
  // Playwright's on-disk name uses underscores where browsers.json uses hyphens.
  const name = dir.slice(0, idx).replace(/_/g, '-');
  const want = wanted.get(name);
  if (want === undefined) {
    // A browser this version has no entry for at all (e.g. removed upstream) is an orphan too.
    orphans.push({ dir, name, rev, want: '(not in browsers.json)' });
  } else if (want !== rev) {
    orphans.push({ dir, name, rev, want });
  } else {
    matched.push({ dir, name, rev });
  }
}

console.log(`playwright browsers: playwright-core ${corePkg.version}, cache ${root}`);
for (const m of matched) console.log(`  ok       ${m.dir}`);

const missing = [...wanted.entries()].filter(
  ([name]) => !matched.some((m) => m.name === name),
);
const installedByDefault = new Set(
  registry.browsers.filter((b) => b.installByDefault).map((b) => b.name),
);
const notablyMissing = missing.filter(([name]) => installedByDefault.has(name));
if (notablyMissing.length > 0) {
  console.log(
    `  info     not installed: ${notablyMissing.map(([n, r]) => `${n}-${r}`).join(', ')}` +
      ` — expected: this repo declares a single \`chromium\` project and CI installs only chromium.`,
  );
}

if (orphans.length === 0) {
  console.log('  every browser on disk is a revision this playwright-core can use.');
  process.exit(0);
}

let wasted = 0;
console.error('\nORPHANED BROWSER REVISIONS — on disk, unusable by the installed playwright-core:\n');
for (const o of orphans) {
  const bytes = dirSizeBytes(join(root, o.dir));
  wasted += bytes;
  console.error(`  ${o.dir}  (${(bytes / MB).toFixed(0)} MB) — this version wants ${o.name}-${o.want}`);
}
console.error(`\n  ${(wasted / MB).toFixed(0)} MB total.`);
console.error(
  '\nPlaywright resolves a browser by revision directory, so these can never be launched — a',
);
console.error('version bump downloaded a new revision and left these behind. Remove them:\n');
for (const o of orphans) console.error(`  rm -rf "${join(root, o.dir)}"`);
process.exit(1);
