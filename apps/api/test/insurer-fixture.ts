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
