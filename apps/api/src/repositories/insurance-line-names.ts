import { Prisma } from '@ibms/db';

/**
 * 🔴 THE INSURANCE LINE'S ARABIC NAME, SENT WITH THE RECORD — OWNER'S DEMO-PATH WALK §P4.
 *
 * «أسماء شركات التأمين وفروع التأمين تُطبَع بالعربية حيث هي موجودة» (decision 150, what went
 * unobjected) — insurer and line names are printed in Arabic wherever they exist.
 *
 * ## Why the server sends it rather than the screen resolving it, and this is MEASURED
 *
 * The obvious shape is for the web to fetch the 32-row catalogue once and look the name up. It
 * cannot: `GET /insurance-lines` is gated on five permissions (`insurer.read`,
 * `provider.office.register`, `provider.insurer.register`, `role.read`, `commission.calculate`),
 * and **`policy.read` is not one of them**. Measured on the seeded fixture 2026-11-17:
 * `CLAIMS_OFFICER` and `POLICY_CHECKING_OFFICER` hold `policy.read` and NONE of those five — so a
 * policy screen that resolved line names from the catalogue would render them for most readers
 * and 403 for two of them.
 *
 * ⛔ And the answer is NOT to widen that route's gate or grant anybody a code. The standing rule
 * is that no role is granted a permission to make a screen work. Sending the name with the record
 * reveals nothing new either: the caller is already reading the record the line belongs to.
 *
 * ## Where the name comes from, in order
 *
 * 1. **The office's own line** (`officeInsuranceLine`) — an office that added a line the standard
 *    32 do not have named it itself, in both scripts, and that name wins for that office.
 * 2. **The managed catalogue** (`insuranceLine_managed`) — the standard line's own Arabic name.
 * 3. **Nothing** — `null`, and the screen renders the stored English string.
 *
 * ⚠️ ONE SOURCE IS CHOSEN AND BOTH NAMES COME FROM IT, never coalesced field by field. That is
 * the rule `insurerIdentity` learned the hard way and recorded: a per-field `??` renders one
 * row's Latin name beside another row's Arabic one the first time a source is half-populated.
 *
 * ## Why there is no string fallback, measured on both databases 2026-11-17
 *
 * `insuranceLineId` is nullable — migration `20261019100000` «mapped what it could» — so a string
 * fallback through `lineCodeForProgrammeLine` was considered. It is not needed and is NOT built:
 * on **dev every row carries the FK** (RFQ 102/102, Policy 87/87, InsuranceProgramLine 924/924),
 * and on db-test the rows that lack it are residue that predates the column — **the newest 20
 * policies and the newest 20 RFQs all carry it**. So the join answers for everything this product
 * creates, and a second resolution path would be a second answer to one question for the sake of
 * rows no screen in production will meet.
 *
 * ⟶ A row with no FK sends `null`, and the screen shows the English string it stored. That is
 *   honest — no Arabic name is KNOWN for that row — and ⛔ it is not a place to invent one.
 */

/** Include this beside any read whose record carries `insuranceLine`. */
export const INSURANCE_LINE_NAME_INCLUDE = {
  insuranceLine_managed: { select: { nameEn: true, nameAr: true } },
  officeInsuranceLine: { select: { nameEn: true, nameAr: true } },
} as const satisfies Prisma.PolicyInclude;

/** The two joined rows a record needs to answer in Arabic. */
export interface InsuranceLineNameSources {
  insuranceLine_managed: { nameEn: string; nameAr: string } | null;
  officeInsuranceLine: { nameEn: string; nameAr: string } | null;
}

/**
 * The line's Arabic name, or null when none is known.
 *
 * ⚠️ A blank or whitespace-only `nameAr` is treated as ABSENT rather than passed through. An
 * empty string reaching a screen renders as nothing, which is the silent blank-cell shape this
 * repository keeps meeting; `null` makes the screen fall back to the English name instead.
 */
export function insuranceLineNameAr(
  row: InsuranceLineNameSources,
): string | null {
  const source = row.officeInsuranceLine ?? row.insuranceLine_managed;
  const ar = source?.nameAr?.trim();
  return ar ? ar : null;
}
