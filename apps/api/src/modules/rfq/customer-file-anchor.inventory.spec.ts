import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DsrStatus, ScreeningCaseStatus } from '@ibms/db';
import {
  CLOSED_DSR_STATUSES,
  CLOSED_SCREENING_CASE_STATUSES,
  OPEN_DSR_STATUSES,
  OPEN_SCREENING_CASE_STATUSES,
} from './customer-file-anchor.service';

/**
 * TWO PROPERTIES, AND NEITHER IS ABOUT WHETHER THE ANCHOR WORKS.
 *
 * Whether it works is proven over HTTP in `rfq-oversight-read.e2e-spec.ts`. This file guards the
 * two ways it could stop being the narrow thing it was designed as:
 *
 *  1. **ONE CONSUMER.** `CustomerFileAnchorService` grants cross-owner reach. It was put beside the
 *     RFQ module rather than in `common/` so that the next service wanting that reach cannot pick
 *     it up quietly — and a header comment saying so is not a control. A second importer fails
 *     here, by name, and widening the consumer set becomes a decision.
 *
 *  2. **EVERY STATUS IS CLASSIFIED.** The open sets are derived by EXCLUDING an exhaustive closed
 *     list, so a status added to either enum later is OPEN by omission. That direction is
 *     deliberate — a new DSR state defaulting to "closed" would silently shut a window the office
 *     is still working in — but it must not happen UNNOTICED, so the union is checked against the
 *     GENERATED Prisma enum. Never against a hand-written member list: that is a second home for
 *     one fact, and the copy is the one that drifts.
 */

const API_SRC = join(__dirname, '..', '..');
const SERVICE_BASENAME = 'customer-file-anchor.service';

/** The ONE file permitted to import it, plus its own tests. Adding a row here is the decision. */
const DECLARED_CONSUMERS = [
  join('modules', 'rfq', 'rfq.service.ts'),
  join('modules', 'rfq', 'rfq.module.ts'),
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('the customer-file anchor has exactly one consumer', () => {
  const files = sourceFiles(API_SRC);

  it('reads the api source tree, so a matcher that stops matching cannot report a clean result', () => {
    // The non-vacuity floor. Without it, a renamed directory turns this whole file into a loop over
    // zero files that passes.
    expect(files.length).toBeGreaterThan(400);
    expect(files.some((f) => f.endsWith(`${SERVICE_BASENAME}.ts`))).toBe(true);
  });

  it('is imported by its declared consumers and by nothing else', () => {
    const importers = files
      .filter((f) => {
        if (f.includes(SERVICE_BASENAME)) return false; // itself
        // SPECS ARE EXCLUDED, with the reason: the property being guarded is which PRODUCTION code
        // can obtain cross-owner reach, and a spec importing the type to build a fixture cannot
        // widen anything at runtime. `rfq.service.spec.ts` does exactly that, and this spec itself
        // names the service in its own assertions.
        if (f.endsWith('.spec.ts')) return false;
        return readFileSync(f, 'utf8').includes(SERVICE_BASENAME);
      })
      .map((f) => relative(API_SRC, f))
      .sort();

    // By NAME in both directions: a new importer fails, and a declared consumer that stopped
    // importing it fails too — so this list cannot quietly become a list of files that once did.
    expect(importers).toEqual(
      [...DECLARED_CONSUMERS].sort((a, b) => a.localeCompare(b)),
    );
    // Path handling via `relative`, never a string strip: `API_SRC + '\\'` is Windows-only and
    // would make this guard red on CI's Linux for a clean tree. (It has happened here.)
    expect(importers.every((p) => !p.startsWith(sep))).toBe(true);
  });

  it('does not reach the write paths — only the read path consults it', () => {
    const service = readFileSync(
      join(API_SRC, 'modules', 'rfq', 'rfq.service.ts'),
      'utf8',
    );
    // `anchors.resolve(` appears ONCE, inside `findReadableRfq`. A second call site is how a write
    // path acquires cross-owner reach, and it would not fail any behaviour test today.
    const calls = service.match(/this\.anchors\.resolve\(/g) ?? [];
    expect(calls).toHaveLength(1);
    // And the WRITES still go through the owner-only policy. COUNTED rather than matched against a
    // formatted snippet: prettier owns the line breaks here, and a string-literal assertion would
    // fail on a reflow of a correct tree. (The first version of this line did exactly that and
    // passed only by luck.)
    const readable = service.match(/this\.findReadableRfq\(/g) ?? [];
    const visible = service.match(/this\.findVisibleRfq\(/g) ?? [];
    // Two READS use the anchored policy: `get` and `listCommunications`.
    expect(readable).toHaveLength(2);
    // AND THE DECISION ITSELF HAS ONE HOME WITH TWO CALLERS — the LIST and the DETAIL.
    // `resolveCustomerReadAccess` is the only place that compares an actor against a customer file
    // and falls back to an anchor. A third caller is a new surface that nobody decided; a second
    // COPY of the comparison would be the drift this whole design is built to avoid, and the list
    // is the copy that would drift (it was written three days after the detail).
    const decision = service.match(/this\.resolveCustomerReadAccess\(/g) ?? [];
    expect(decision).toHaveLength(2);
    // Two WRITES keep the owner-only policy: `addInsurers` and `logCommunication`. If this becomes
    // 1, a write path was moved onto the anchored policy — which no behaviour test would catch,
    // because an owner and a whole-book reader behave identically under both policies.
    expect(visible).toHaveLength(2);
  });
});

describe('every status of both enums is classified', () => {
  it('DsrStatus: the open and closed sets partition the GENERATED enum', () => {
    const generated = (Object.values(DsrStatus) as DsrStatus[]).sort();
    const union = [...OPEN_DSR_STATUSES, ...CLOSED_DSR_STATUSES].sort();
    expect(union).toEqual(generated);
    // Disjoint, so a status cannot be both.
    expect(
      OPEN_DSR_STATUSES.filter((s) => CLOSED_DSR_STATUSES.includes(s)),
    ).toEqual([]);
    // The owner's reading, pinned by name rather than by count: a request still being corrected is
    // still being handled.
    expect([...CLOSED_DSR_STATUSES].sort()).toEqual([
      'CLOSED',
      'FULFILLED',
      'REJECTED',
    ]);
    expect([...OPEN_DSR_STATUSES].sort()).toEqual([
      'IDENTITY_VERIFIED',
      'IN_PROGRESS',
      'PARTIALLY_FULFILLED',
      'RECEIVED',
    ]);
  });

  it('ScreeningCaseStatus: the open and closed sets partition the GENERATED enum', () => {
    const generated = (
      Object.values(ScreeningCaseStatus) as ScreeningCaseStatus[]
    ).sort();
    const union = [
      ...OPEN_SCREENING_CASE_STATUSES,
      ...CLOSED_SCREENING_CASE_STATUSES,
    ].sort();
    expect(union).toEqual(generated);
    expect(
      OPEN_SCREENING_CASE_STATUSES.filter((s) =>
        CLOSED_SCREENING_CASE_STATUSES.includes(s),
      ),
    ).toEqual([]);
    expect([...CLOSED_SCREENING_CASE_STATUSES]).toEqual(['CLOSED']);
    expect([...OPEN_SCREENING_CASE_STATUSES].sort()).toEqual([
      'ASSIGNED',
      'ESCALATED',
      'OPEN',
      'UNDER_REVIEW',
    ]);
  });
});
