#!/usr/bin/env node
/**
 * `npm run test:security` — the SCA (known-CVE dependency) gate from
 * `ibms-brain/meta/context/verification-contract.md`.
 *
 * ## TWO SETS, AND ONLY ONE OF THEM FAILS THE BUILD (owner decision, 2026-10-11)
 *
 * BLOCKING — advisories reachable in what SHIPS. Which those are is decided by
 * npm's own `--omit=dev`, asked rather than re-derived from the lockfile here.
 * They fail the build unless listed in ACKNOWLEDGED below.
 *
 * REPORTED — advisories that exist ONLY in the dev tree. Printed every run,
 * never fatal. They need no acknowledgement, which is what keeps ACKNOWLEDGED
 * meaningful: it is for a SHIPPED advisory with genuinely no fix, and nothing
 * else.
 *
 * ### The cost of that split, written down rather than discovered later
 *
 * The commit that introduced this split also fixed `tinypool` — two CRITICAL
 * prototype-pollution-to-RCE advisories — and `vitest`. BOTH are
 * devDependencies, so under this policy neither would have failed the build.
 * They were fixed because somebody read the output. That is the trade being
 * made here: a dev-side CRITICAL is now something a person must READ, not
 * something CI refuses on their behalf. So a dev-only critical prints an
 * extra line saying exactly that, because the one thing this must not become
 * is quiet.
 *
 * ### It also makes the gate honest about its own scope
 *
 * `test:security` used to run unfiltered inside the api-scoped `backend` CI
 * job, while the `frontend` job audited nothing at all. Measured on
 * 2026-10-11: the only advisory then failing the build was `braces`, reached
 * solely through `eslint-config-next` — a front-end dev dependency failing a
 * check named `backend`, while the job that owns it never looked. Both jobs now
 * pass their own `--workspace`, and any extra flags handed to this script are
 * forwarded to `npm audit`.
 *
 * ## Why this refuses rather than reports when it cannot MEASURE
 *
 * Every audit must parse, and must have examined a non-zero dependency tree. A
 * blank or unparsable audit is a FAILURE, not a clean result: an advisory list
 * that is empty because nothing ran looks exactly like one that is empty
 * because nothing is wrong — and "I could not check" is precisely the state
 * `scripts/check-ci.sh` was written for.
 *
 * RULES for adding an entry to ACKNOWLEDGED below — all four must hold, and
 * the entry must say so in `why`:
 *   1. There is no upgrade path. "The maintainer has not shipped one" —
 *      verified, not assumed. Read `first_patched_version` off the advisory
 *      itself (`gh api advisories/<GHSA-id>`) and the package's own published
 *      version list, not just the latest major of whatever pins it. Two
 *      advisories on one package are routine and they do not share a fix: on
 *      2026-10-11 `braces` carried both CVE-2024-4068 (fixed in 3.0.3) and
 *      CVE-2026-93687 (range `<= 3.0.3`, `first_patched_version: null`), and
 *      citing the first as evidence about the second would have put a false
 *      reason in this file.
 *   2. The vulnerable code is UNREACHABLE from this application.
 *   3. `reviewBy` is set. Past that date the gate fails again, so an
 *      acknowledgement cannot quietly become permanent.
 *   4. Anything not listed here, in the SHIPPED set, still fails the build.
 */
import { execFileSync } from 'node:child_process';

/** @type {{name: string, why: string, reviewBy: string}[]} */
const ACKNOWLEDGED = [
  {
    name: 'multer',
    why: `GHSA-q7qp-rjg7-q26m / CVE-2026-113872, published 2026-10-23 — DoS via a pending
ASYNCHRONOUS fileFilter after request teardown.

OWNER DECISION 52, 2026-10-24: THIS IS RECORDED AS *THE VULNERABLE CODE PATH DOES NOT
EXIST IN THIS PRODUCT*, NOT AS *A KNOWN VULNERABILITY ACCEPTED*. Those are different
claims and the second one is not ours to make: this system goes in front of a regulator.
The distinction is the whole of her ruling, so do not reword this entry into the
language of accepted risk.

THE CLAIM IS THE ADVISORY'S OWN SENTENCE, not our reading of it: any application using
multer with an ASYNCHRONOUS fileFilter is affected, and uploads using a SYNCHRONOUS
fileFilter are not affected. Measured: the string fileFilter appears ZERO times in
apps/api/src; the api's single multipart route
(modules/customer/legacy-import.controller.ts) passes only limits { fileSize, files: 1 };
and @nestjs/platform-express injects none — the string occurs once in its whole tree, in
a .d.ts DECLARING the option as optional. files: 1 also means there can never be a
second file sitting with a filter pending while another is rejected, which IS the
mechanism the advisory describes.

AND THE PREMISE IS PINNED BY A TEST, WHICH IS HER CONDITION AND IS NOT OPTIONAL:
apps/api/src/common/multipart-upload-exposure.inventory.spec.ts asserts both facts BY
NAME over the whole api source — no upload route passes a fileFilter, and none accepts
more than one file — so the PREMISE fails rather than the feature, and it fails for a
SECOND upload route somebody adds rather than only for a change to the existing one. It
carries a non-vacuity floor, because every assertion in it is a loop and an empty loop
passes. Three committed plants cover both premises and the floor.

THE 2026-09 HISTORY IS WHY THAT TEST EXISTS RATHER THAN A COMMENT. Four multer
advisories were accepted here on these same two grounds and the reachability half had
ALREADY BEEN FALSE for sixteen days, because a FileInterceptor route landed four days
after the acknowledgement was written (IMPROVEMENTS.md section 1.82). A record whose
premise nothing checks is a record that goes quietly false.

RULE 1, NO UPGRADE PATH, AND THIS IS A WAIT WITH A DATE RATHER THAN AN EXEMPTION. The
fix EXISTS upstream in multer 2.5.0; what is being waited for is Nest moving its exact
pin. @nestjs/platform-express pins multer at an EXACT 2.4.0, and EVERY published version
through 12.2.0 still pins 2.4.0 — checked one at a time rather than off the latest
major, which is rule 1's own instruction. That sentence is what makes the review date
honest.

AND THE THREE MECHANISMS THAT FORCE 2.5.0 WERE EACH TRIED AND EACH BROKE SOMETHING,
PROVEN BY RUNNING THE UPLOAD ROUTE. A root override of ^2.5.0 alone made npm DROP multer
from the tree entirely (node_modules/multer ABSENT) — and this gate then went GREEN
BECAUSE THE PACKAGE HAD VANISHED, which would have shipped a latent crash on the one
route that uses it. An exact 2.5.0 override did the same. Declaring multer ^2.5.0
directly in apps/api PLUS the override did install 2.5.0 deduped onto one copy — and
legacy-import.e2e-spec.ts + legacy-import-report.e2e-spec.ts went from 8/8 to FIVE
FAILED, every multipart request answering 400. Isolated afterwards by single variable:
body-parser 2.4.0 alone is 8/8, multer 2.4.0 UNDER the override is 5 failed, and HEAD is
8/8 — so it is the OVERRIDE MECHANISM against an exact pin, which is this file's own
recorded finding met for the second time.

THE OBVIOUS REMEDY IS WITHDRAWN, AND THE MEASUREMENT IS WHY: removing our upload route
would NOT clear this advisory. multer is NOT OUR DEPENDENCY — it appears exactly ONCE in
the lockfile, as a dependency of @nestjs/platform-express, and is declared in no
package.json of ours. So dropping the one multipart route would leave the package
installed and the advisory standing, while costing the customer-import feature. If the
owner declines this record, the answer is to carry the red until Nest moves its pin,
never to override it.`,
    reviewBy: '2026-11-24',
  },
  /*
   * EMPTY, and that is the intended steady state — every advisory at `high` or above fails this gate.
   *
   * ## What was here, and why it is gone rather than corrected
   *
   * Four high-severity multer DoS advisories (`GHSA-wc9g-mqfw-jrwm` and three siblings) were accepted
   * from 2026-09-09 to 2026-09-29 on two grounds: no upgrade path, and the vulnerable code being
   * unreachable. The reachability half had been FALSE for sixteen days — a bulk-import route with a
   * `FileInterceptor` landed four days after the acknowledgement was written, and a web caller made it
   * reachable from the UI on 2026-09-28. That history is recorded in `IMPROVEMENTS.md` § 1.82 with the
   * original wording struck through in place, because the original reasoning is what explains why four
   * high advisories were ever accepted.
   *
   * The owner declined to accept it on corrected grounds: the system goes in front of a regulator, and it
   * does not ship with a known accepted vulnerability. **So the fix was found instead**, and the entry is
   * removed because RULE 1 ABOVE NO LONGER HOLDS — there IS an upgrade path:
   *
   *   `@nestjs/platform-express@11.2.6` pins `multer: 2.4.0`, which is fixed. A PATCH bump inside the
   *   11.x line, no Nest major involved. `apps/api/package.json` states `^11.2.6` as a FLOOR so the fixed
   *   multer is a requirement rather than a lucky resolution.
   *
   * ## An `overrides` entry does NOT work here, proven rather than assumed
   *
   * `overrides: { multer: '2.4.0' }` was tried five ways — flat against the existing lockfile, flat with
   * the lockfile recomputed, the nested `@nestjs/platform-express` form, a `^2.4.0` range, and a
   * from-scratch lockfile regeneration after deleting the installed package. **Every one resolved 2.2.0**,
   * with `npm ls` marking its own tree `invalid: "2.4.0" ... overridden` — npm 10.8.0 records the override
   * and installs the pinned version anyway, because `platform-express` pins an EXACT version rather than a
   * range. The two overrides that remain in `package.json` (`fast-uri`, `deepmerge-ts`) only ever chose
   * WITHIN their parents' ranges, which is why they appeared to work.
   *
   * So: do not reach for an override to escape an exact pin in this repo. Raise the pinning package.
   *
   * ## Adding an entry here
   *
   * All four rules above must hold and the entry must say so. Rule 1 means "no upgrade path" — check the
   * PATCH line of whatever pins it, not only the latest major: 11.2.6 was five patches ahead of the
   * version installed, and the last five of them still pinned the vulnerable multer.
   */
];

const acknowledgedByName = new Map(ACKNOWLEDGED.map((a) => [a.name, a]));

/*
 * Extra flags from `npm run test:security -- --workspace api`, forwarded to
 * every `npm audit` call below. The two CI jobs use this so each audits the
 * workspace it is named for.
 */
const passthrough = process.argv.slice(2);

function runAudit(extra) {
  try {
    return execFileSync(
      'npm',
      ['audit', '--json', '--audit-level=high', ...extra, ...passthrough],
      {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (err) {
    // npm audit exits non-zero when it finds anything at or above the level —
    // the JSON is still on stdout, and that is the payload we want.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

/**
 * One audit, and a refusal to return any result this gate cannot stand behind.
 */
function auditReport(label, extra) {
  let raw;
  try {
    raw = runAudit(extra);
  } catch (err) {
    console.error(
      `test:security COULD NOT RUN the ${label} audit: ${err?.message ?? err}`,
    );
    process.exit(1);
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    console.error(
      `test:security COULD NOT PARSE the ${label} audit. A gate that cannot measure must refuse, not pass.`,
    );
    console.error(`First 400 bytes of what it got:\n${String(raw).slice(0, 400)}`);
    process.exit(1);
  }

  const examined = report.metadata?.dependencies?.total ?? 0;
  if (examined === 0) {
    console.error(
      `test:security: the ${label} audit examined 0 dependencies. An empty advisory list from an audit that looked at nothing is not a clean result.`,
    );
    process.exit(1);
  }

  return report;
}

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

function realFindings(report) {
  const found = new Map();
  for (const v of Object.values(report.vulnerabilities ?? {})) {
    if (v.severity !== 'high' && v.severity !== 'critical') continue;
    if (cascadeOnly(v)) continue;
    found.set(v.name, v);
  }
  return found;
}

const titlesOf = (v) =>
  (v.via ?? []).map((x) => (typeof x === 'string' ? x : x.title)).join('; ');

const shipped = realFindings(auditReport('production (--omit=dev)', ['--omit=dev']));
const everything = realFindings(auditReport('full tree', []));

// In the tree but not in what ships. npm made that call, not this script.
const devOnly = [...everything.values()].filter((v) => !shipped.has(v.name));

const blocking = [];
const acknowledged = [];
const expired = [];
const today = new Date().toISOString().slice(0, 10);

for (const v of shipped.values()) {
  const ack = acknowledgedByName.get(v.name);
  if (!ack) {
    blocking.push(v);
    continue;
  }
  if (ack.reviewBy < today) expired.push({ v, ack });
  else acknowledged.push({ v, ack });
}

for (const { v, ack } of acknowledged) {
  console.log(
    `ACKNOWLEDGED  ${v.severity.padEnd(8)} ${v.name} (review by ${ack.reviewBy})`,
  );
}
for (const { v, ack } of expired) {
  console.error(
    `EXPIRED       ${v.severity.padEnd(8)} ${v.name} — acknowledgement lapsed on ${ack.reviewBy}. Re-verify it is still unfixable and unreachable, then move the date or fix it.`,
  );
}
for (const v of blocking) {
  console.error(`BLOCKING      ${v.severity.padEnd(8)} ${v.name} — ${titlesOf(v)}`);
}

/*
 * An acknowledgement matching nothing in the shipped set is one the tree has
 * outgrown. Said out loud — not fatal, because the trigger for it is an
 * advisory being FIXED — so the list cannot quietly accumulate entries that
 * excuse nothing.
 */
for (const ack of ACKNOWLEDGED) {
  if (!shipped.has(ack.name)) {
    console.log(
      `STALE ACK     ${'—'.padEnd(8)} ${ack.name} is acknowledged but is no longer a shipped high/critical advisory. Remove the entry.`,
    );
  }
}

for (const v of devOnly) {
  console.log(`REPORTED      ${v.severity.padEnd(8)} ${v.name} — ${titlesOf(v)}`);
}
if (devOnly.length > 0) {
  const criticals = devOnly.filter((v) => v.severity === 'critical');
  console.log(
    `\n${devOnly.length} dev-only high/critical advisory(ies) above. They do NOT ship and do NOT fail this gate. They are printed to be READ, and fixed wherever a fix exists.`,
  );
  if (criticals.length > 0) {
    console.log(
      `READ THIS: ${criticals.length} of those is CRITICAL (${criticals
        .map((v) => v.name)
        .join(', ')}). Nothing here will stop a merge on it. Fix it, or decide not to — deliberately.`,
    );
  }
}

const failures = blocking.length + expired.length;
if (failures > 0) {
  console.error(
    `\ntest:security FAILED — ${blocking.length} unacknowledged and ${expired.length} expired high/critical advisories in what SHIPS.`,
  );
  process.exit(1);
}

console.log(
  `\ntest:security OK — 0 unacknowledged high/critical advisories in what ships (${acknowledged.length} acknowledged, ${devOnly.length} dev-only reported).`,
);
