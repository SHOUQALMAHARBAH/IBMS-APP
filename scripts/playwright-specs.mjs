#!/usr/bin/env node
/**
 * Resolve Playwright spec filters and REFUSE any that matches nothing.
 *
 * ## Why this exists
 *
 * `npx playwright test a.spec.ts b.spec.ts settings` runs a.spec and b.spec and SILENTLY IGNORES
 * `settings`, because no spec filename contains it — the screens live at `app/(app)/settings/...` but the
 * specs are `roles.spec.ts`, `users.spec.ts`, `org-units.spec.ts` and so on. Playwright does not warn. The
 * run passes, the count looks plausible, and the verification claim is false.
 *
 * That happened three times in one session and was caught by CI, not locally: a reported "41/41 across the
 * batch-6 screens" had run none of the eight `settings/*` screens' specs, and the one real regression among
 * them — a strict-mode violation on `/settings/roles` — reached CI red.
 *
 * It is the same class as a grep truncated by `head`, an extractor that returns a blank line, and a plant
 * whose anchor no longer matches: **the tool answers "nothing" and the reader hears "nothing wrong".** The
 * house treatment is for the tool to refuse, which is what `plant.mjs` does with an anchor matching zero
 * times and what `test-summary.mjs` does with a missing summary line.
 *
 * ## Usage
 *
 *   node scripts/playwright-specs.mjs roles users org-units          # prints the resolved spec paths
 *   node scripts/playwright-specs.mjs --screen settings/roles        # resolve by SCREEN path
 *
 * Exits non-zero, naming the offender, if any argument resolves to no spec file. Feed the output to
 * Playwright:
 *
 *   cd apps/web && CI=1 npx playwright test $(node ../../scripts/playwright-specs.mjs roles users)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Resolved relative to THIS FILE, never to the caller's cwd.
//
// The first version used a cwd-relative path and required the repository root. Invoked from `apps/web`
// inside a `$(...)` substitution it died, the substitution came back EMPTY, and `npx playwright test` with no
// arguments then ran the ENTIRE suite until it timed out. A guard whose own failure produces an empty
// argument list has recreated the hole it exists to close — `$(...)` discards the exit code, so refusing
// loudly is not enough on its own. Hence `--run` below, which never hands its output to a shell.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "apps", "web");
const E2E = path.join(WEB, "e2e");

function die(code, message) {
  process.stderr.write(`playwright-specs: ${message}\n`);
  process.exit(code);
}

if (!fs.existsSync(E2E)) {
  die(2, `no e2e directory at ${E2E} — is this script still inside the repo?`);
}

const run = process.argv.includes("--run");
const args = process.argv
  .slice(2)
  .filter((a) => a !== "--screen" && a !== "--run");
if (args.length === 0) {
  die(
    2,
    "usage: node scripts/playwright-specs.mjs <filter>…\nA filter matching no spec is an ERROR, never a silently smaller run — that is the bug this exists to make impossible.",
  );
}

const specs = fs
  .readdirSync(E2E)
  .filter((f) => f.endsWith(".spec.ts"));

const resolved = new Set();
const unmatched = [];
for (const arg of args) {
  // A screen path (`settings/roles`) resolves on its LAST segment, because that is what the spec is named
  // after — the mismatch between screen paths and spec names is the whole reason this file exists.
  const needle = arg.replace(/\.spec\.ts$/, "").split("/").filter(Boolean).pop();
  const hits = specs.filter((f) => f.includes(needle));
  if (hits.length === 0) {
    unmatched.push(arg);
    continue;
  }
  for (const h of hits) resolved.add(h);
}

if (unmatched.length > 0) {
  die(
    1,
    `these filters match no spec file: ${unmatched.join(", ")}\n` +
      `Playwright would have ignored them and run a SMALLER suite that still passes. ` +
      `Available specs:\n  ${specs.join("\n  ")}`,
  );
}

const files = [...resolved].sort();

if (!run) {
  process.stdout.write(files.join(" ") + "\n");
  process.exit(0);
}

// A LINGERING WEB SERVER IS THE COMMONEST WAY THIS RUN DIES, and it is litter rather than a code fault.
// `CI=1` sets `reuseExistingServer: false`, so Playwright refuses port 3000 — correctly, and with a message
// that says nothing about how to clear it. Twice in one session: once from a run I timed out, once from a
// background run that was killed and left its server behind. The repo's own rule is that every refusal names
// the way forward, so this one does.
const held = spawnSync(
  "node",
  [
    "-e",
    "const n=require('net');const s=n.createServer();s.once('error',()=>process.exit(1));" +
      "s.once('listening',()=>{s.close();process.exit(0)});s.listen(3000,'127.0.0.1')",
  ],
  { stdio: "ignore" },
);
if (held.status !== 0) {
  die(
    1,
    "port 3000 is already in use, and CI=1 makes Playwright refuse to reuse it.\n" +
      "That is usually a web server left behind by a run that was killed or timed out. Clear it:\n" +
      '  powershell -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen | ' +
      'Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"',
  );
}

// `--run` spawns Playwright itself, so there is no shell substitution to come back empty. This is the mode
// to prefer: with `$(…)` the caller has to check an exit code that `$(…)` has already thrown away.
process.stderr.write(
  `playwright-specs: running ${files.length} spec file(s): ${files.join(" ")}\n`,
);
const result = spawnSync(
  "npx",
  ["playwright", "test", ...files],
  {
    cwd: WEB,
    stdio: "inherit",
    // `shell: true` is REQUIRED on Windows: npx is a `.cmd` shim and spawning it without a shell fails
    // silently — no output at all, just a non-zero exit, which is indistinguishable from a suite that
    // crashed before printing anything. Third time in this file's short life that a failure produced
    // NOTHING rather than an error.
    shell: process.platform === "win32",
    env: { ...process.env, CI: "1" },
  },
);
if (result.error) {
  die(2, `could not start playwright: ${result.error.message}`);
}
// A run that produced no summary is not a pass. The caller usually pipes through `test-summary.mjs`, which
// catches that — but this exit code must not report success when the child never really ran.
process.exit(result.status ?? 1);
