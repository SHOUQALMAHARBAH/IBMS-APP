/**
 * 🔴 WHAT STANDING DOES EACH SCREEN PRINT FOR THE SAME OFFICE? — asked of the SEEDED DATABASE.
 *
 * The full walk of 2026-11-27 reported that `/provider-offices` shows office B's licence —
 * expiring 2025-12-31, today being well past that — as «ساري», the word the licence screen
 * reserves for a term inside its printed dates. Decision 167/17, as the owner amended it, says
 * to MEASURE FIRST: if the state is «قيدَ التجديد» after the declaration recorded on 25
 * November then the new-business block is lifted by right (decision 128) and only the provider
 * screen's WORD is wrong; if there is no declaration and it still reads «ساري», that is the
 * defect.
 *
 * ## What this script does, and why it is not a reading of either screen
 *
 * It reads every office's REAL licence row and REAL regulatory acts out of the database and runs
 * the three shipped functions over them, side by side:
 *
 *   - `deriveRenewalUnderStudy` — decision 128's four conditions, the inner answer
 *   - `deriveLicenseStanding`   — the six-value standing the LICENCE screen prints and the
 *                                 issuance gate enforces, including `mayPractise`
 *   - `isBrokerLicenseCurrentlyLapsed` — the DATE-ONLY lapse the PROVIDER screen negates to
 *                                 decide whether to print «ساري»
 *
 * ⟶ So the disagreement is computed rather than observed, and it is attributed to a named
 *   function rather than to a screen. `license-standing.config.ts` forbids reinstating the third
 *   one in the standing derivation in its own words («⛔ Do not reinstate
 *   `isBrokerLicenseCurrentlyLapsed` here»), and the provider service is where it survived.
 *
 * ## ⛔ It is read-only, and it answers the block question without issuing anything
 *
 * `mayPractise` is the field `assertMayPractise` reads before each of the six gated acts — it
 * throws on `!mayPractise` and on nothing else. So printing `mayPractise` per office IS the
 * answer to «does the new-business block fire for office B today», taken from the gate's own
 * input rather than from a POST that would leave a policy or an RFQ on the owner's database.
 *
 * ## Run it
 *
 *   npx dotenv -e .env -- npx tsx scripts/measurements/licence-standing-two-screens.ts
 *
 * Reads `.env`, which is the dev database. It opens no transaction and writes nothing.
 */
import { PrismaClient } from '@ibms/db';

import {
  deriveRenewalUnderStudy,
  isBrokerLicenseCurrentlyLapsed,
} from '../../apps/api/src/modules/compliance-risk/broker-license.config';
import { deriveLicenseStanding } from '../../apps/api/src/modules/compliance-risk/license-standing.config';
import { licenceFiguresFrom } from '../../apps/api/src/modules/compliance-risk/legal-figures.config';

const prisma = new PrismaClient();

/** The words each screen would print, so the comparison is in the reader's terms and not in
 *  enum values. Copied from the two dictionaries deliberately: if either is reworded this
 *  script keeps saying what it said, and the point is the DISAGREEMENT, not the spelling. */
const LICENCE_SCREEN_WORD: Record<string, string> = {
  NO_TERM_ON_RECORD: 'لا توجدُ مدّةُ ترخيصٍ مسجّلة',
  ACTIVE: 'ساري',
  RENEWAL_PENDING: 'قيدَ التجديد',
  EXPIRED: 'منتهي',
  SUSPENDED: 'موقوف',
  CANCELLED: 'ملغى',
};

async function main(): Promise<void> {
  const now = new Date();
  console.log(`now = ${now.toISOString()}\n`);

  const figures = licenceFiguresFrom(
    await prisma.legalValue.findMany({
      where: {
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
    }),
  );
  console.log(
    `art. 11 filing window = ${figures.renewalApplicationDueDaysBeforeExpiry} days before expiry`,
  );
  console.log(
    `art. 14/c suspension limit = ${figures.article14cSuspensionLimitYears} years\n`,
  );

  const organizations = await prisma.organization.findMany({
    where: { type: { in: ['BROKERAGE_OFFICE', 'INSURANCE_COMPANY'] } },
    select: { id: true, subdomain: true, legalName: true, type: true },
    orderBy: { subdomain: 'asc' },
  });

  let disagreements = 0;
  let measured = 0;

  for (const org of organizations) {
    /*
     * THE SAME TERM THE GATE PICKS. `pickCurrentTerm` orders by `expiresAt` desc then `id` desc,
     * and the provider view's `current_term` CTE uses that identical order — written out here
     * rather than imported because the service that owns it is behind Nest's DI.
     */
    const term = await prisma.brokerLicense.findFirst({
      where: { organizationId: org.id },
      orderBy: [{ expiresAt: 'desc' }, { id: 'desc' }],
      select: {
        licenseNumber: true,
        issuedAt: true,
        expiresAt: true,
        renewalRequestedAt: true,
        renewalProofDocumentId: true,
        renewalReferenceNumber: true,
        renewalDeclaration: {
          select: { actorNameShown: true, declaredAt: true },
        },
      },
    });

    const acts = await prisma.regulatoryAction.findMany({
      where: { organizationId: org.id },
      select: {
        kind: true,
        basis: true,
        effectiveFrom: true,
        suspendedUntil: true,
        decisionRef: true,
        scopeLines: { select: { insuranceLineId: true } },
      },
      orderBy: { effectiveFrom: 'asc' },
    });

    const actRows = acts.map((a) => ({
      kind: a.kind as
        | 'SUSPENSION'
        | 'CANCELLATION'
        | 'REINSTATEMENT'
        | 'DEFICIENCY_NOTICE'
        | 'RENEWAL_REFUSAL',
      basis: a.basis as 'BROKER_REQUEST' | 'SANCTION',
      effectiveFrom: a.effectiveFrom,
      suspendedUntil: a.suspendedUntil,
      decisionRef: a.decisionRef,
      scopeKeys: a.scopeLines.map((l) => l.insuranceLineId ?? ''),
    }));

    console.log(`── ${org.subdomain}  (${org.type})  ${org.legalName}`);

    if (!term) {
      console.log('   no licence term on record\n');
      continue;
    }
    measured += 1;

    console.log(
      `   term ${term.licenseNumber}  expires ${term.expiresAt.toISOString().slice(0, 10)}` +
        `  filed ${term.renewalRequestedAt?.toISOString().slice(0, 10) ?? '(not filed)'}`,
    );
    console.log(
      `   proof ${term.renewalProofDocumentId ? 'on record' : 'ABSENT'}` +
        `  ref ${term.renewalReferenceNumber?.trim() ? 'on record' : 'ABSENT'}` +
        `  declaration ${term.renewalDeclaration ? 'on record' : 'ABSENT'}` +
        `  acts ${actRows.length}`,
    );

    const underStudy = deriveRenewalUnderStudy(term, actRows, now, figures);
    const standing = deriveLicenseStanding(term, actRows, now, figures);
    const dateOnlyLapsed = isBrokerLicenseCurrentlyLapsed(term, now, figures);

    /*
     * WHAT THE PROVIDER SCREEN PRINTS TODAY, reproduced from its own four-way branch. The three
     * inputs are the ones the view carries: whether there is a term at all, and the date-only
     * lapse. There is no «قيدَ التجديد» branch on that screen, which is the finding.
     */
    const providerWord = dateOnlyLapsed
      ? 'منتهٍ — يُمنع العمل الجديد'
      : 'ساري';
    const licenceWord = LICENCE_SCREEN_WORD[standing.status] ?? standing.status;

    console.log(`   renewalUnderStudy      ${underStudy.state}`);
    console.log(
      `   deriveLicenseStanding  ${standing.status}   mayPractise=${standing.mayPractise}`,
    );
    console.log(`   isCurrentlyLapsed      ${dateOnlyLapsed}  (date-only)`);
    console.log(`   /regulatory-compliance prints  «${licenceWord}»`);
    console.log(`   /provider-offices      prints  «${providerWord}»`);

    if (licenceWord !== providerWord) {
      disagreements += 1;
      console.log(`   🔴 THE TWO SCREENS DISAGREE`);
    }

    /*
     * AND THE BLOCK, ANSWERED FROM THE GATE'S OWN INPUT. `assertMayPractise` throws exactly when
     * `mayPractise` is false, so this line is the answer to whether a new RFQ, placement,
     * recommendation, renewal, cover increase or certificate is refused for this office today.
     */
    console.log(
      `   new-business block (the six gated acts): ${standing.mayPractise ? 'DOES NOT FIRE' : 'FIRES'}`,
    );
    console.log('');
  }

  console.log(`offices with a term measured: ${measured}`);
  console.log(`offices where the two screens disagree: ${disagreements}`);

  /*
   * AN EMPTY POPULATION IS A GAP AND NEVER A PASS — the lesson message 54 §7 paid for. A run
   * over a database with no past-expiry office proves nothing about the branch this batch is
   * about, and must say so rather than printing a confident zero.
   */
  if (measured === 0) {
    console.log(
      '\n⚠️  NO OFFICE CARRIES A LICENCE TERM ON THIS DATABASE — this run is VACUOUS.',
    );
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
