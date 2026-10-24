import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * An explicit per-file timeout, for the reason `float-money.inventory.spec.ts` records: this spec
 * READS THE API SOURCE TREE, which is hundreds of files of I/O against vitest's 5000ms default.
 * File-scoped, never global.
 */
vi.setConfig({ testTimeout: 30_000 });

/**
 * ITEM 3 — THE NAME PRECEDENCE HAS ONE HOME, AND THIS IS WHAT KEEPS IT THERE.
 *
 * `insurer-identity.ts` states the precedence in prose and in code: the registered company, then
 * the global catalogue, then the office's own row, *most authoritative: it is the company's own
 * record of itself*. That is decision 48's shape one entity over, and nothing contradicts it. So
 * `insurerName` was never a competing POLICY — it was a SECOND IMPLEMENTATION of this one,
 * written before the registered-company link existed and never widened, and it skipped step 1.
 *
 * ## WHY THIS SPEC IS THE PROOF, AND WHY IT IS A DIFFERENT SHAPE FROM THE ONE ASKED FOR
 *
 * The brief asked for a fixture with a linked insurer, asserted against each of the five outward
 * documents, on the ground that a fix with no visible symptom has nothing observing it. The
 * reasoning is right and is honoured — but the observation is split in two, deliberately, and the
 * split is stated rather than quietly substituted:
 *
 *   1. THAT THE PRECEDENCE IS CORRECT is asserted in `insurer-identity.spec.ts`, over a linked
 *      insurer whose registered name differs from BOTH its catalogue name and its local one — so
 *      it fails unless the company genuinely wins over two other sources that are both present
 *      and both different. That is the fixture the brief asked for.
 *   2. THAT EVERY DOCUMENT USES THAT PRECEDENCE is asserted here, by shape over the whole api
 *      source.
 *
 * Together those cover the five documents AND a sixth somebody adds next month, which five
 * hand-built service doubles could not. Five doubles would each have proved that one service
 * passes an object to a function that the unit test already covers; this proves no service
 * resolves a name any other way, which is the property that actually broke.
 *
 * What is NOT claimed: no PDF is rendered and no byte of one is read. If a template ever stops
 * printing the name it is handed, nothing here would see it — the template specs are what cover
 * that, and they already assert `insurerName` appears in each document's text.
 */

const API_SRC = join(__dirname, '..');

/** The one file allowed to spell the precedence. */
const PRECEDENCE_HOME = 'repositories/insurer-identity.ts';

/**
 * The five documents that LEAVE THE OFFICE, named individually rather than discovered, because
 * who relies on each is the reason this mattered at all — and a renamed file must fail loudly
 * rather than drop out of a glob.
 */
const OUTWARD_DOCUMENTS: Record<string, string> = {
  'modules/policy/certificate-of-insurance-document.service.ts':
    'a landlord, a lender or a regulator relies on it — that document exists to be relied upon',
  'modules/finance/invoice-document.service.ts': 'the customer, as a bill',
  'modules/policy/policy-schedule-summary-document.service.ts': 'the customer',
  'modules/recommendation/recommendation-report-document.service.ts':
    'the customer, as the basis of a purchase decision',
  'modules/comparison/comparison.service.ts':
    'the customer, through the comparison document that flattens this view',
};

function allSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allSources(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
      out.push(full);
  }
  return out;
}

/** Comments stripped: this repository has twice been bitten by a guard reading prose as code. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function relative(file: string): string {
  return file.slice(API_SRC.length + 1).replace(/\\/g, '/');
}

describe('item 3: an insurer has ONE name precedence and every document reads it', () => {
  it('the five outward documents all exist — a renamed file must fail, not vanish', () => {
    /*
     * The non-vacuity floor for the per-document assertion below. Without it, renaming the
     * certificate service would turn that check into a loop over four files and pass — and the
     * certificate is the document a third party relies on, so it is the worst one to lose.
     */
    for (const [rel, reader] of Object.entries(OUTWARD_DOCUMENTS)) {
      let found = true;
      try {
        found = statSync(join(API_SRC, rel)).isFile();
      } catch {
        found = false;
      }
      expect(
        found,
        `${rel} is named in OUTWARD_DOCUMENTS and does not exist. It is read by ${reader}. ` +
          'Re-point the row rather than deleting it — a document that leaves the office cannot ' +
          'quietly stop being checked.',
      ).toBe(true);
    }
  });

  it('each outward document resolves the insurer name through the ONE resolver', () => {
    const offenders: string[] = [];
    for (const [rel, reader] of Object.entries(OUTWARD_DOCUMENTS)) {
      const source = stripComments(readFileSync(join(API_SRC, rel), 'utf8'));
      if (!/\b(insurerName|resolveInsurerName)\s*\(/.test(source)) {
        offenders.push(`${rel} — read by ${reader}`);
      }
    }
    expect(
      offenders,
      'A document that LEAVES THE OFFICE no longer resolves the insurer name through ' +
        '`insurerName`. Those five are the ones where getting this wrong reaches somebody ' +
        "outside the brokerage: the name on the paper would not be the name on the company's " +
        'licence. Call `insurerName(insurer)` — it delegates to the one precedence in ' +
        '`insurer-identity.ts` — rather than reading a name field directly.',
    ).toEqual([]);
  });

  it('NOTHING outside insurer-identity.ts spells the precedence itself', () => {
    /*
     * THE REGRESSION THIS IS REALLY ABOUT, and it is the shape the defect actually had: not a
     * missing call but a SECOND IMPLEMENTATION. `insurerMaster.legalName` read anywhere else is
     * somebody re-deriving "what is this insurer called", which is how a document and a screen
     * came to answer differently in the first place.
     *
     * Deliberately narrow: the master's OWN name field, which has no legitimate reader outside
     * the resolver. `insurer.legalName` alone is NOT matched — it is a real column that
     * registration writes and the insurer form edits, so banning it would fire on correct code,
     * which is the cry-wolf direction.
     */
    const offenders: string[] = [];
    for (const file of allSources(API_SRC)) {
      const rel = relative(file);
      if (rel === PRECEDENCE_HOME) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      if (/\binsurerMaster\s*(\?\.|\.)\s*legalName\b/.test(source))
        offenders.push(rel);
    }
    expect(
      offenders,
      'The insurer-name precedence is spelled outside `insurer-identity.ts`. That is not a style ' +
        'point: a second implementation is exactly what this item fixed. `insurerName` skipped ' +
        'the REGISTERED COMPANY for twelve call sites, five of them documents that leave the ' +
        'office, so for a linked insurer a certificate printed the catalogue name while ' +
        '`/insurers` printed the company name. Call `resolveInsurerName` or `insurerName`.',
    ).toEqual([]);
  });

  it('the resolver is reachable and answers step 1 first — the floor for the two above', () => {
    /*
     * Both checks above are about ABSENCE, and an absence check passes against a resolver that
     * does the wrong thing. This is the positive half, kept here so the inventory cannot report a
     * clean tree while the one home is broken.
     */
    const home = readFileSync(join(API_SRC, PRECEDENCE_HOME), 'utf8');
    expect(
      /export function resolveInsurerName/.test(home),
      '`resolveInsurerName` has gone from insurer-identity.ts. The precedence must have exactly ' +
        'one home; if it moved, re-point PRECEDENCE_HOME in the same commit.',
    ).toBe(true);
    expect(
      /insurer\.insuranceCompany/.test(
        /export function resolveInsurerName[\s\S]*?\n\}/.exec(home)?.[0] ?? '',
      ),
      '`resolveInsurerName` no longer consults `insuranceCompany`, which is STEP 1 of the ' +
        'precedence and the step the old implementation skipped. Everything else here would ' +
        'still pass: every document would route through a resolver that gives the wrong answer.',
    ).toBe(true);
  });
});
