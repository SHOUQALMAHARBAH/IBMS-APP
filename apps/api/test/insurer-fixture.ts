import { prisma } from './tenant-prisma';

/**
 * Creates an insurer for a fixture, in the shape Part I §5 introduced.
 *
 * Before Phase 3 step 10 a spec could write `prisma.insurer.create({ data: {
 * name } })`, because the company's name lived on the office's own row. It no
 * longer does: identity is global (`InsurerMaster`, shared by every office) and
 * `Insurer` is just this office's relationship with it. Every fixture therefore
 * needs both rows, and this is the one place that knows how.
 *
 * The master is upserted on its unique legal name rather than created, so two
 * fixtures naming the same company converge on one master — the same behaviour
 * the seed and the API have, instead of a test-only shortcut that would hide a
 * real duplicate-master bug.
 */
export async function makeInsurer(
  legalName: string,
  relationship: {
    financialStrengthRating?: string | null;
    creditTermsDays?: number | null;
    rfqContactName?: string | null;
    rfqContactEmail?: string | null;
    claimsContactEmail?: string | null;
    underwriterContact?: string | null;
    isActive?: boolean;
  } = {},
  master: { legalNameAr?: string | null; linesOffered?: string[] } = {},
): Promise<{ id: string; insurerMasterId: string; name: string }> {
  const insurerMaster = await prisma.insurerMaster.upsert({
    where: { legalName },
    update: {},
    create: {
      legalName,
      legalNameAr: master.legalNameAr ?? null,
      linesOffered: master.linesOffered ?? [],
    },
  });

  const insurer = await prisma.insurer.create({
    data: { insurerMasterId: insurerMaster.id, ...relationship },
  });
  // `name` is echoed back for the many fixtures that assert on the displayed
  // insurer name: it lives on the master now, so a spec would otherwise have to
  // join to find out what it just named.
  return { id: insurer.id, insurerMasterId: insurerMaster.id, name: legalName };
}

/**
 * Creates an OFFICE-LOCAL insurer — a company with no row in the global
 * catalogue.
 *
 * The case insurer management exists for, and the one every consumer has to
 * handle identically: the name lives on the office's own row, `insurerMasterId`
 * is NULL, and `insurer-identity.ts` coalesces. A spec that needs to prove a
 * report, document or screen renders a local insurer correctly uses this rather
 * than hand-writing the insert, so there is one definition of "local insurer" in
 * the fixtures just as there is one definition of the name join in the source.
 *
 * `legalNameAr` is supplied by default rather than left null: both scripts are
 * required for a local row on the real create path, and a fixture that omitted
 * the Arabic name would let a bidi rendering bug pass.
 */
export async function makeLocalInsurer(
  legalName: string,
  relationship: {
    legalNameAr?: string | null;
    linesOffered?: string[];
    financialStrengthRating?: string | null;
    creditTermsDays?: number | null;
    rfqContactName?: string | null;
    rfqContactEmail?: string | null;
    claimsContactEmail?: string | null;
    underwriterContact?: string | null;
    isActive?: boolean;
  } = {},
): Promise<{ id: string; insurerMasterId: null; name: string }> {
  const insurer = await prisma.insurer.create({
    data: {
      // Named explicitly rather than omitted: the column is nullable now, and a
      // fixture that relied on the default would stop proving anything the day
      // a default appeared.
      insurerMasterId: null,
      legalName,
      legalNameAr: relationship.legalNameAr ?? `${legalName} (ع)`,
      linesOffered: relationship.linesOffered ?? [],
      financialStrengthRating: relationship.financialStrengthRating,
      creditTermsDays: relationship.creditTermsDays,
      rfqContactName: relationship.rfqContactName,
      rfqContactEmail: relationship.rfqContactEmail,
      claimsContactEmail: relationship.claimsContactEmail,
      underwriterContact: relationship.underwriterContact,
      isActive: relationship.isActive,
    },
  });
  return { id: insurer.id, insurerMasterId: null, name: legalName };
}
