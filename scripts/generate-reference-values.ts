/**
 * MODULE 0-ب — the eight reference tables' values and the new enums' members, AS SEEDED.
 *
 * ## Why this is generated and not written
 *
 * The owner owes an Arabic description for every value below and will not write one for a value she
 * has not seen — on her own stated reasoning: that is how the permission catalogue came to credit
 * her with four lines that an agent had written. So this reads the SEEDED DATABASE rather than the
 * seed source, for the same reason `db:permission-catalogue` does: what the screens render is what
 * the database holds, and a document generated from the source can disagree with it.
 *
 * ## What `descriptionAr` is for, and why most rows are empty
 *
 * Item (c) gave every reference table a nullable `descriptionAr`, required only on the
 * RULE-BEARING tables — a legal form or a business model changes what the system does with a row,
 * where a city or a bank is a label. The column exists on all eight for uniformity; the obligation
 * does not. This export shows which rows already carry one so the owner writes what is missing
 * rather than re-writing what is there.
 *
 * Usage:  npx tsx scripts/generate-reference-values.ts
 *         (or `npm run db:reference-values`)
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const prisma = new PrismaClient();

/** The eight, in the order item (c) seeded them, with what each row DECIDES. */
const TABLES = [
  {
    model: 'legalForm',
    title: 'LegalForm — الشكل القانوني',
    ruleBearing: true,
    why: 'Art. 10/a/1/a requires a natural-person broker to register as a SOLE ESTABLISHMENT, so the row decides whether a registration is well-formed. Rule-bearing.',
  },
  {
    model: 'licensingAuthority',
    title: 'LicensingAuthority — الجهة المرخِّصة',
    ruleBearing: true,
    why: 'Which regulator issued the licence. Rule-bearing: the instructions this product implements are the Central Bank’s, and a licence from another authority is not governed by them.',
  },
  {
    model: 'businessModel',
    title: 'BusinessModel — نموذج العمل',
    ruleBearing: true,
    why: 'Takaful versus conventional. Rule-bearing in WORDING ONLY — it changes terminology on documents and NOTHING may branch on it, or it quietly becomes a second product.',
  },
  {
    model: 'ratingAgency',
    title: 'RatingAgency — وكالة التصنيف',
    ruleBearing: true,
    why: 'Paired with a financial-strength rating by `Insurer_rating_carries_its_date`: a rating with no agency and no as-of date is a number nobody can source.',
  },
  {
    model: 'currency',
    title: 'Currency — العملة',
    ruleBearing: true,
    why: 'Every threshold in Instructions No. 9 of 2026 is in JOD, and there is no conversion path — so a non-JOD amount cannot be compared against any of them. Rule-bearing by its absence.',
  },
  {
    model: 'country',
    title: 'Country — الدولة',
    ruleBearing: false,
    why: 'A label. Not validated against the city, declared.',
  },
  {
    model: 'city',
    title: 'City — المدينة',
    ruleBearing: false,
    why: 'A label. Not validated against the country, declared.',
  },
  {
    model: 'bank',
    title: 'Bank — البنك',
    ruleBearing: false,
    why: 'A label on the office’s banking details and on a bank guarantee. The art. 15/i client-funds rules are module 14’s and read no row here.',
  },
] as const;

/**
 * The enums added by this module. FOUR, not two — measured against `origin/main`, which had 66
 * enums against 70 here. Stated because the brief said two: `BrokerageKind` and
 * `RegulatoryActionBasis` are the ones a reader would think of, and `IntegrationMethod` and
 * `RegulatoryActionKind` arrived in the same module and need descriptions just as much.
 */
const ENUMS = [
  {
    name: 'BrokerageKind',
    title: 'BrokerageKind — نوع الوساطة',
    why: 'Direct insurance brokerage or reinsurance brokerage. RECORDED AND READ BY NOTHING: no guard depends on it, and this product holds no regulatory text for reinsurance brokerage, so it can neither exempt nor bind such a broker. The registration screen says so on the field.',
  },
  {
    name: 'RegulatoryActionKind',
    title: 'RegulatoryActionKind — نوع الفعل الرقابي',
    why: 'What the regulator did. Append-only: the licence STATUS is derived from these acts and never stored (decision 71).',
  },
  {
    name: 'RegulatoryActionBasis',
    title: 'RegulatoryActionBasis — سند الفعل',
    why: 'Whether a suspension is at the broker’s OWN REQUEST (art. 14/a) or a SANCTION (art. 21/b). Load-bearing: art. 14/c’s two-year deemed-cancellation applies to the first and whether it reaches the second is UNSETTLED in the text and is not inferred.',
  },
  {
    name: 'IntegrationMethod',
    title: 'IntegrationMethod — طريقة التكامل',
    why: 'How the system exchanges data with an insurance company. An enum because these are four genuinely different code paths, and `api_endpoint` is required only for API. NO CREDENTIAL ever enters these tables.',
  },
] as const;

async function main(): Promise<void> {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);

  out('# Module 0-ب — reference values and new enum members, AS SEEDED');
  out();
  out('**GENERATED — do not hand-edit.** `npm run db:reference-values`');
  out();
  out(
    'Read from the seeded database, not from the seed source, for the same reason the permission',
  );
  out(
    'catalogue is: what a screen renders is what the database holds, and a document generated from',
  );
  out('the source can disagree with it.');
  out();

  let refRows = 0;
  for (const t of TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (prisma as any)[t.model].findMany({
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      select: {
        code: true,
        nameEn: true,
        nameAr: true,
        descriptionAr: true,
      },
    });
    refRows += rows.length;
    out(`## ${t.title} — ${rows.length} row(s)`);
    out();
    out(
      `**${t.ruleBearing ? 'RULE-BEARING' : 'A LABEL'}.** ${t.why}`,
    );
    out();
    out('| code | English name | Arabic name | Arabic description |');
    out('|---|---|---|---|');
    for (const r of rows) {
      const desc = r.descriptionAr ? r.descriptionAr : '**— OWED —**';
      out(`| \`${r.code}\` | ${r.nameEn} | ${r.nameAr} | ${desc} |`);
    }
    out();
  }

  let enumMembers = 0;
  out('---');
  out();
  out('# The enums this module added — FOUR, not two');
  out();
  out(
    'Measured against `origin/main`: 66 enums there, 70 here. The brief said two; these are the four,',
  );
  out('and all eleven members need a description.');
  out();
  for (const e of ENUMS) {
    const rows = await prisma.$queryRawUnsafe<{ label: string }[]>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1 ORDER BY e.enumsortorder`,
      e.name,
    );
    enumMembers += rows.length;
    out(`## ${e.title} — ${rows.length} member(s)`);
    out();
    out(`**${e.why}**`);
    out();
    out('| member | Arabic description |');
    out('|---|---|');
    for (const r of rows) out(`| \`${r.label}\` | **— OWED —** |`);
    out();
  }

  out('---');
  out();
  out('## What is owed, counted');
  out();
  out('| | count |');
  out('|---|---|');
  out(`| reference-table rows | **${refRows}** |`);
  out(`| enum members | **${enumMembers}** |`);
  out(`| **total values needing an Arabic description** | **${refRows + enumMembers}** |`);
  out();
  out(
    'The brief estimated "roughly forty". The measured figure is above, and it is higher because the',
  );
  out(
    'module added four enums rather than two. Rows that already carry a `descriptionAr` are shown',
  );
  out('with it, so what is written is not re-written.');
  out();

  const path = 'docs/module-0b-reference-values.md';
  writeFileSync(path, lines.join('\n'), 'utf8');
  console.log(
    `${path}: ${refRows} reference rows across ${TABLES.length} tables, ${enumMembers} members across ${ENUMS.length} enums, ${refRows + enumMembers} values total.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
