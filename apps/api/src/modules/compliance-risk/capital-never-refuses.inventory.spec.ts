import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/*
 * AN EXPLICIT PER-FILE TIMEOUT, AND IT IS NOT A MITIGATION FOR A FLAKE.
 *
 * This spec READS THE API SOURCE TREE from disk. The measurement is already recorded, in
 * `common/role-scope.inventory.spec.ts`: 6915ms for one such pass under a parallel run, against
 * vitest's 5000ms default — so these guards pass alone every time and fail under load, which looks
 * exactly like flakiness and is I/O cost. Two DIFFERENT source-reading guards failed in two
 * consecutive full `vitest run` passes here, which is the signature of a shared budget problem
 * rather than of either spec.
 *
 * Normally raising a timeout is the wrong move and this repository has a recorded lesson saying so.
 * What makes this the exception is that nothing is hidden: the assertion is correct and the work is
 * genuinely file I/O over hundreds of files.
 *
 * FILE-SCOPED, NEVER GLOBAL. `apps/api` sets no `testTimeout`, and raising it there would also
 * raise the budget for 3,297 ordinary unit tests, where 5s IS a real signal — a hung mock or an
 * unawaited promise. That is precisely the "buys time and hides the next crossing" failure.
 */
vi.setConfig({ testTimeout: 30_000 });

/**
 * ART. 4/a's CAPITAL FIGURE IS INFORMATION. NOTHING REFUSES A SAVE BECAUSE OF IT.
 *
 * ## WHY THIS IS A GUARD AND NOT A NOTE
 *
 * The owner's governing decision: the system must be easy and familiar to a working broker,
 * compliant without being a cage — "show and warn, do not refuse", and do not block a save unless
 * the database already blocked it or the act is irreversible.
 *
 * The capital figure is the clearest case in this module. `requiredCapitalForScope` counts branches
 * within a type against art. 4/a's slabs (≤6, ≤12, >12), and the COUNTING UNIT is not settled —
 * our catalogue is the client's 32 lines, while the Central Bank may license against a shorter
 * regulatory classification. A refusal built on a count we are not certain the regulator shares
 * would stop a legitimate registration of an office the Bank has already licensed.
 *
 * `requiredCapitalForScope`'s own header also flags the "per type" reading as SUMMED rather than
 * taken from the largest type, and says why that is tolerable: a reading that can only make a
 * warning appear is a safe place to be approximately right. Inside a refusal it would not be. This
 * spec is what keeps it outside one.
 *
 * ## WHAT IT CHECKS, AND THE TWO THINGS IT CANNOT
 *
 * It reads the api source and fails if a refusal — a `throw`, an exception constructor — appears
 * within a few lines of a capital read. That is deliberately coarse, which is why the non-vacuity
 * floor below matters: a matcher that stops finding the capital reads at all would pass silently.
 *
 * It cannot prove a refusal placed far from its read, and it cannot prove a screen does not disable
 * its own submit button. The first is bounded by the proximity window being generous; the second is
 * a Playwright assertion on `/provider-register-office`, where the registration succeeds with a
 * capital shortfall and the office exists afterwards — both halves, in one test.
 */

const API_SRC = join(__dirname, '../..');

/** Every capital-assessment symbol a refusal would have to read to be about the capital figure. */
const CAPITAL_READS = [
  'assessCapital',
  'requiredCapitalForScope',
  'requiredCapitalForType',
  'capitalIsUnrecorded',
  'paidUpCapital',
];

/** How a refusal looks in this codebase. `assessStaffing(...).meetsRequirement` is a DIFFERENT rule
 *  — item (f)'s two-approved-people requirement — so `meetsRequirement` is deliberately not in
 *  `CAPITAL_READS`: it is shared vocabulary, and including it would make this spec fail on a rule the
 *  owner approved. */
const REFUSALS = [
  'throw new UnprocessableEntityException',
  'throw new BadRequestException',
  'throw new ConflictException',
  'throw new ForbiddenException',
];

/** Lines of slack either side of a capital read. Generous on purpose: a refusal written tightly
 *  against its read is the realistic shape, and widening this costs nothing but false confidence in
 *  the other direction. */
const WINDOW = 6;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    if (!entry.endsWith('.ts') || entry.includes('.spec.')) continue;
    acc.push(full);
  }
  return acc;
}

interface Hit {
  file: string;
  line: number;
  read: string;
  refusal: string;
}

function scan(): { reads: number; hits: Hit[] } {
  let reads = 0;
  const hits: Hit[] = [];
  for (const file of sourceFiles(API_SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Comments are not code. The config file explains the rule at length and would otherwise
      // match every term in this spec.
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
      const read = CAPITAL_READS.find((r) => code.includes(r));
      if (!read) return;
      reads += 1;
      for (
        let j = Math.max(0, i - WINDOW);
        j <= Math.min(lines.length - 1, i + WINDOW);
        j += 1
      ) {
        const near = lines[j].replace(/^\s*(\/\/|\*|\/\*).*$/, '');
        const refusal = REFUSALS.find((f) => near.includes(f));
        if (refusal) {
          hits.push({
            file: relative(API_SRC, file).split(sep).join('/'),
            line: i + 1,
            read,
            refusal,
          });
        }
      }
    });
  }
  return { reads, hits };
}

describe("art. 4/a's capital figure", () => {
  it('is READ by real code — the floor that stops this spec going vacuous', () => {
    // Without this, a renamed symbol or a moved file makes the scan find nothing and the assertion
    // below pass against an empty set. This repository has shipped that shape more than once.
    const { reads } = scan();
    expect(
      reads,
      'no capital-assessment symbol was found anywhere in the api source — the matcher has stopped matching, and the assertion below now proves nothing',
    ).toBeGreaterThan(8);
  });

  it('REFUSES NOTHING — no save is blocked because of it', () => {
    /*
     * The governing decision, as a guard. If this fails, the question to ask is not "how do I make
     * the test pass" but "did somebody just make a money figure block a registration, on a count the
     * regulator may not share".
     */
    const { hits } = scan();
    expect(
      hits.map((h) => `${h.file}:${h.line} — ${h.refusal} near ${h.read}`),
      'a refusal sits beside a capital read. Art. 4/a is INFORMATION in this system: the counting unit for its slabs is not settled, and a refusal built on it would stop a legitimate registration of an office the Central Bank has already licensed',
    ).toEqual([]);
  });
});
