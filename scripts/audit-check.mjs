#!/usr/bin/env node
/**
 * `npm run test:security` — the SCA (known-CVE dependency) gate from
 * `ibms-brain/meta/context/verification-contract.md`.
 *
 * Wraps `npm audit --audit-level=high` so that a genuinely unfixable advisory
 * can be acknowledged explicitly instead of leaving the gate permanently red
 * (which trains everyone to ignore it) or claiming a fix that never happened.
 *
 * RULES for adding an entry to ACKNOWLEDGED below — all four must hold, and
 * the entry must say so in `why`:
 *   1. There is no upgrade path. "The maintainer has not shipped one" —
 *      verified, not assumed.
 *   2. The vulnerable code is UNREACHABLE from this application.
 *   3. `reviewBy` is set. Past that date the gate fails again, so an
 *      acknowledgement cannot quietly become permanent.
 *   4. Anything not listed here still fails the build.
 */
import { execFileSync } from 'node:child_process';

/** @type {{name: string, why: string, reviewBy: string}[]} */
const ACKNOWLEDGED = []; // PLANT: forces the audit gate red to prove the Chromium guard fires


const acknowledgedByName = new Map(ACKNOWLEDGED.map((a) => [a.name, a]));

function runAudit() {
  try {
    return execFileSync(
      'npm',
      ['audit', '--json', '--audit-level=high'],
      { encoding: 'utf8', shell: process.platform === 'win32' },
    );
  } catch (err) {
    // npm audit exits non-zero when it finds anything at or above the level —
    // the JSON is still on stdout, and that is the payload we want.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

const report = JSON.parse(runAudit());
const vulns = Object.values(report.vulnerabilities ?? {});

const blocking = [];
const acknowledged = [];
const expired = [];
const today = new Date().toISOString().slice(0, 10);

/**
 * `npm audit` reports a package as vulnerable both when it CARRIES an advisory
 * and when it merely DEPENDS on one that does — so a single advisory on a leaf
 * shows up once as itself and again as every ancestor. Only the package
 * carrying the advisory is a real finding: an object entry in `via` is a real
 * GHSA, a string entry is just the name of a dependency that has one.
 * Judging the cascade rows independently would make one unfixable leaf look
 * like six separate problems.
 */
const cascadeOnly = (v) => (v.via ?? []).every((x) => typeof x === 'string');

for (const v of vulns) {
  if (v.severity !== 'high' && v.severity !== 'critical') continue;

  // A cascade row carries no advisory of its own; whichever leaf does is
  // judged on its own row, so counting this one too would just inflate the
  // number. Nothing is lost: an unacknowledged leaf still fails the gate.
  if (cascadeOnly(v)) continue;

  const ack = acknowledgedByName.get(v.name);
  if (!ack) {
    blocking.push(v);
    continue;
  }
  if (ack.reviewBy < today) expired.push({ v, ack });
  else acknowledged.push({ v, ack });
}

for (const { v, ack } of acknowledged) {
  console.log(`ACKNOWLEDGED  ${v.severity.padEnd(8)} ${v.name} (review by ${ack.reviewBy})`);
}
for (const { v, ack } of expired) {
  console.error(
    `EXPIRED       ${v.severity.padEnd(8)} ${v.name} — acknowledgement lapsed on ${ack.reviewBy}. Re-verify it is still unfixable and unreachable, then move the date or fix it.`,
  );
}
for (const v of blocking) {
  const via = (v.via ?? [])
    .map((x) => (typeof x === 'string' ? x : x.title))
    .join('; ');
  console.error(`BLOCKING      ${v.severity.padEnd(8)} ${v.name} — ${via}`);
}

const failures = blocking.length + expired.length;
if (failures > 0) {
  console.error(
    `\ntest:security FAILED — ${blocking.length} unacknowledged and ${expired.length} expired high/critical advisories.`,
  );
  process.exit(1);
}

console.log(
  `\ntest:security OK — 0 unacknowledged high/critical advisories (${acknowledged.length} acknowledged, see scripts/audit-check.mjs).`,
);
