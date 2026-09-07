import type { Prisma } from '@ibms/db';
import { compareMoney } from '../../common/money.util';
import { MONEY_STRING } from '../../common/dto.util';

/**
 * Process 20 — Policy Checking / Quality Control (backlog Part C #20, Domain
 * B). The pure, deterministic core: a **line-by-line comparison of Requested
 * Coverage vs Issued Policy** over exactly the four dimensions the backlog
 * names — `limits`, `sumsInsured`, `namedPerils`, `extensions`.
 *
 * `ibms-brain/meta/context/policy-lifecycle.md` § "The rules that aren't
 * obvious": "Policy Checking must be performed by someone other than whoever
 * requested/placed the cover — a hard system rule. A discrepancy ... puts the
 * policy in `Discrepancy — Correction Requested` and blocks Delivery until
 * resolved; this is logged as a Professional Indemnity risk event, not
 * silently corrected and moved on."
 *
 * The "issued" side is the current open `PolicySchedule` (recorded at #19);
 * the "requested" side is transcribed by the Policy Checking Officer from the
 * client's signed acceptance / the accepted quotation into the same shape.
 * The system does the diff — `discrepancyFound` is derived, never asserted by
 * the caller.
 */

export interface CoverageSnapshot {
  limits: Record<string, unknown>;
  sumsInsured: Record<string, unknown>;
  namedPerils: string[];
  extensions: string[];
}

/** One `limits` / `sumsInsured` key compared across the two snapshots. A key
 * present on only one side has `null` for the other and `match: false`. */
export interface FieldComparison {
  key: string;
  requested: string | null;
  issued: string | null;
  match: boolean;
}

/** A `namedPerils` / `extensions` set comparison. `missing` = requested but
 * not on the issued policy; `extra` = on the issued policy but not requested. */
export interface ListComparison {
  requested: string[];
  issued: string[];
  missing: string[];
  extra: string[];
  match: boolean;
}

export interface CoverageChecklist {
  limits: FieldComparison[];
  sumsInsured: FieldComparison[];
  namedPerils: ListComparison;
  extensions: ListComparison;
}

export interface CoverageDiff {
  discrepancyFound: boolean;
  mismatchCount: number;
  checklist: CoverageChecklist;
  /** Human-readable list of the mismatches — embeds the differing figures
   * (that is the record's purpose; it is NOT what goes into the audit
   * `afterValue`). Used for `PolicyChecking.discrepancyDetail` and the PI
   * risk-event description. */
  summary: string;
}

function scalarToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** Normalises a free-text coverage descriptor for comparison — trimmed,
 * internal whitespace collapsed, case-folded — so a transcription that
 * differs only in `"Fire"` vs `"fire"` or `"debris  removal"` vs
 * `"debris removal"` is not a false-positive discrepancy (which would block
 * Delivery and log a PI risk event). A genuine wording difference differs by
 * more than that. */
function normalizeDescriptor(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Two coverage figures are equal if both parse as money (then compared at
 * fils precision — `"5000000"` equals `"5000000.000"`) or, failing that, as
 * normalised descriptors. Never a float compare. */
function valuesEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  if (MONEY_STRING.test(a) && MONEY_STRING.test(b)) {
    return compareMoney(a, b) === 0;
  }
  return normalizeDescriptor(a) === normalizeDescriptor(b);
}

function diffMap(
  requested: Record<string, unknown>,
  issued: Record<string, unknown>,
): FieldComparison[] {
  const keys = [
    ...new Set([...Object.keys(requested), ...Object.keys(issued)]),
  ].sort();
  return keys.map((key) => {
    const r = scalarToString(requested[key]);
    const i = scalarToString(issued[key]);
    return { key, requested: r, issued: i, match: valuesEqual(r, i) };
  });
}

/** Set comparison over `namedPerils` / `extensions`. Membership is tested on
 * the normalised descriptor (case / whitespace insensitive — see
 * `normalizeDescriptor`) so a casing-only transcription difference is not a
 * discrepancy, but the returned lists keep the original text for display. */
function diffList(requested: string[], issued: string[]): ListComparison {
  const dedupe = (xs: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of xs) {
      const key = normalizeDescriptor(x);
      if (key.length > 0 && !seen.has(key)) {
        seen.add(key);
        out.push(x.trim());
      }
    }
    return out;
  };
  const req = dedupe(requested);
  const iss = dedupe(issued);
  const issKeys = new Set(iss.map(normalizeDescriptor));
  const reqKeys = new Set(req.map(normalizeDescriptor));
  const missing = req.filter((x) => !issKeys.has(normalizeDescriptor(x)));
  const extra = iss.filter((x) => !reqKeys.has(normalizeDescriptor(x)));
  return {
    requested: req,
    issued: iss,
    missing,
    extra,
    match: missing.length === 0 && extra.length === 0,
  };
}

export function diffCoverage(
  requested: CoverageSnapshot,
  issued: CoverageSnapshot,
): CoverageDiff {
  const limits = diffMap(requested.limits, issued.limits);
  const sumsInsured = diffMap(requested.sumsInsured, issued.sumsInsured);
  const namedPerils = diffList(requested.namedPerils, issued.namedPerils);
  const extensions = diffList(requested.extensions, issued.extensions);

  const limitMismatches = limits.filter((c) => !c.match);
  const sumMismatches = sumsInsured.filter((c) => !c.match);
  const mismatchCount =
    limitMismatches.length +
    sumMismatches.length +
    namedPerils.missing.length +
    namedPerils.extra.length +
    extensions.missing.length +
    extensions.extra.length;

  const parts: string[] = [];
  for (const c of limitMismatches) {
    parts.push(
      `limits.${c.key}: requested ${c.requested ?? '(none)'}, issued ${c.issued ?? '(none)'}`,
    );
  }
  for (const c of sumMismatches) {
    parts.push(
      `sumsInsured.${c.key}: requested ${c.requested ?? '(none)'}, issued ${c.issued ?? '(none)'}`,
    );
  }
  if (namedPerils.missing.length) {
    parts.push(
      `namedPerils missing from issued policy: ${namedPerils.missing.join(', ')}`,
    );
  }
  if (namedPerils.extra.length) {
    parts.push(
      `namedPerils on issued policy but not requested: ${namedPerils.extra.join(', ')}`,
    );
  }
  if (extensions.missing.length) {
    parts.push(
      `extensions missing from issued policy: ${extensions.missing.join(', ')}`,
    );
  }
  if (extensions.extra.length) {
    parts.push(
      `extensions on issued policy but not requested: ${extensions.extra.join(', ')}`,
    );
  }

  return {
    discrepancyFound: mismatchCount > 0,
    mismatchCount,
    checklist: { limits, sumsInsured, namedPerils, extensions },
    summary: parts.join('; ').slice(0, 4000),
  };
}

/** The `ProfessionalIndemnityRiskEvent.description` — Process 54 ("exposures
 * from advice/placement errors, e.g. requested Sum Insured not matching amount
 * sent to insurer"). It legitimately carries the differing figures (that is
 * the risk-register entry's purpose); it is NOT the audit `afterValue`. */
export function piRiskEventDescription(
  policyNumber: string | null,
  policyId: string,
  summary: string,
): string {
  const ref = policyNumber ? `policy ${policyNumber}` : `policy ${policyId}`;
  return `Policy-checking discrepancy on ${ref}: ${summary}`.slice(0, 8000);
}

/** Audit `afterValue` for a `PolicyChecking` write — counts + ids + booleans
 * only. The `checklistResult` and `discrepancyDetail` embed coverage figures,
 * so they never enter the audit trail (ibms-brain/meta/lex/
 * sensitive-data-handling.md — "metadata not body", same as #12–19). */
export function policyCheckingAuditSnapshot(row: {
  policyId: string;
  placedByUserId: string;
  checkedByUserId: string | null;
  discrepancyFound: boolean;
  mismatchCount: number;
  discrepancyLoggedAsPiRiskEvent: boolean;
}): Prisma.InputJsonObject {
  return {
    policyId: row.policyId,
    placedByUserId: row.placedByUserId,
    checkedByUserId: row.checkedByUserId,
    discrepancyFound: row.discrepancyFound,
    mismatchCount: row.mismatchCount,
    discrepancyLoggedAsPiRiskEvent: row.discrepancyLoggedAsPiRiskEvent,
  };
}
