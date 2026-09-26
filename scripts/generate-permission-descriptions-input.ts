/**
 * Regenerates `docs/permission-catalogue-for-descriptions.txt` — the OWNER'S INPUT FILE for the
 * Arabic one-line permission descriptions.
 *
 * ## Why this script exists
 *
 * That file's own header said "Generated from the seeded database, so this IS what the Role screen
 * renders — not a separate list that can drift from it." No generator existed. It was hand-written
 * once, at 186 codes, and the catalogue has grown since: every code from four-action Phase 1, the
 * discard, and the duty-segregation mode was invisible to the person being asked to describe them.
 *
 * This is the SECOND time this repo has found a file claiming to be generated with no generator
 * behind it — `apps/web/e2e/fixtures/role-permissions.ts` said "regenerate rather than hand-edit"
 * for months, and the script that closed that one carries the lesson in its own header. An
 * instruction naming a tool nobody built is worse than no instruction, because it reads as a process
 * being observed.
 *
 * ## THE PROPERTY THAT MATTERS MOST: it never destroys a line she has written
 *
 * Every `ar:` line already filled in is harvested BY CODE and carried forward; a blank placeholder is
 * emitted only where the existing file has nothing for that code. Getting this wrong would mean the
 * tool that exists to help her is the tool that deletes her work. So `--check` does not merely say
 * "stale" — it names any written line a regenerate would drop, and `harvestExistingArabic` has its
 * own spec, because the file is currently empty and a round trip that silently dropped everything
 * would look identical to a correct one today and lose real work in three weeks.
 *
 * ## Why it reuses buildMatrix rather than re-deriving the families
 *
 * The [5-STATE] / [toggle] marking is not cosmetic: it tells her that one row on screen carries
 * several separate decisions. That grouping is decided by `apps/web/lib/admin/permission-matrix.ts`,
 * which the screen itself uses. Re-deriving it here would be a second copy of the rule, and the copy
 * is the one that drifts — which is why this script is TypeScript run through `tsx` rather than a
 * `.mjs` that could not import it.
 *
 * ## Both variants read DB-TEST, deliberately
 *
 * The sibling fixture generator writes from DEV and is CHECKED against DB-TEST, and that split made its
 * gate unsatisfiable for a while — dev held roles the owner had created by hand, so the check reported
 * STALE forever. The trap does not bite here, because this file contains only the GLOBAL catalogue
 * (code, module, description) and no per-office grant, so both databases answer identically. But
 * "identical because of a property" is a thing to arrange rather than rely on, so write and check read
 * the same database: the one `verify.sh` and CI can build from nothing.
 *
 * Usage:  npm run db:permission-descriptions
 *         npm run db:permission-descriptions:check
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { buildMatrix, codesOfRow } from '../apps/web/lib/admin/permission-matrix';

const OUT = 'docs/permission-catalogue-for-descriptions.txt';
const CHECK_ONLY = process.argv.includes('--check');
const RULE = '-'.repeat(96);
const BAR = '='.repeat(96);
const BLANK = '.'.repeat(64);

/**
 * The Arabic module headings, taken from the Role screen's own dictionary so the file she reads names
 * each module exactly as the screen does. Keyed by the module slug stored on `Permission`.
 *
 * A module missing here falls back to its slug rather than throwing: a new module should show up in
 * her file in English rather than making the generator refuse to run.
 */
const MODULE_AR: Record<string, string> = {
  admin: 'الإدارة والنظام',
  claims: 'المطالبات',
  'commercial-front-office': 'المكتب الأمامي التجاري',
  'compliance-risk': 'الالتزام والمخاطر',
  customer: 'العملاء',
  'customer-service': 'خدمة العملاء',
  finance: 'المالية',
  'insurance-operations': 'العمليات التأمينية',
  management: 'التقارير الإدارية',
  pdpl: 'حماية البيانات',
  sla: 'مستويات الخدمة',
  'supporting-operations': 'العمليات المساندة',
};

const CODE_LINE = /^[a-z0-9.-]+$/;

/**
 * Every `ar:` line already written, keyed by code.
 *
 * A row of dots is the placeholder this generator emits, and it is NOT an answer — that distinction
 * is the whole job. Exported for its own spec.
 */
export function harvestExistingArabic(existing: string): Record<string, string> {
  const out: Record<string, string> = {};
  let code: string | null = null;
  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (CODE_LINE.test(trimmed) && trimmed.includes('.')) {
      code = trimmed;
      continue;
    }
    if (trimmed.startsWith('ar:') && code !== null) {
      const value = trimmed.slice(3).trim();
      // Strip dots and whitespace: what remains is real text, or the line was a placeholder.
      if (value.replace(/[.\s]/g, '') !== '') out[code] = value;
      code = null;
    }
  }
  return out;
}

/**
 * Every non-placeholder Arabic line in a file, as raw text and attributed to nothing.
 *
 * Independent of {@link harvestExistingArabic} on purpose — it is the check on that function, so it
 * must not share its parsing. It answers the only question the safety warning needs: which sentences
 * a person typed into this file, so the regenerate can be asked whether each one survives.
 */
export function writtenLinesIn(existing: string): string[] {
  const out: string[] = [];
  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('ar:')) continue;
    const value = trimmed.slice(3).trim();
    if (value === '' || value.replace(/[.\s]/g, '') === '') continue;
    out.push(value);
  }
  return out;
}

/** The three lines one code contributes: its name, the stored English hint, and her Arabic slot. */
function entry(
  code: string,
  descriptions: ReadonlyMap<string, string>,
  written: Readonly<Record<string, string>>,
): string[] {
  return [
    `      ${code}`,
    `          en: ${descriptions.get(code) ?? ''}`,
    `          ar: ${written[code] ?? BLANK}`,
  ];
}

export function render(
  catalogue: readonly { code: string; module: string; description: string }[],
  written: Readonly<Record<string, string>>,
): string {
  const descriptions = new Map(catalogue.map((p) => [p.code, p.description]));
  const modules = buildMatrix(catalogue);

  let families = 0;
  let familyCodes = 0;
  let toggles = 0;
  const blocks: string[] = [];

  for (const mod of modules) {
    const lines: string[] = [
      `MODULE: ${mod.module}   —   ${MODULE_AR[mod.module] ?? mod.module}   (${mod.codes.length} codes)`,
      RULE,
      '',
    ];
    for (const row of mod.rows) {
      if (row.kind === 'crud') {
        families += 1;
        const codes = [...codesOfRow(row)].sort();
        familyCodes += codes.length;
        const states = Object.keys(row.codes).sort().join(' / ');
        lines.push(`  [5-STATE] ${row.family}   (${states})`);
        for (const code of codes) lines.push(...entry(code, descriptions, written));
      } else {
        toggles += 1;
        lines.push(`  [toggle]  ${row.code}`);
        lines.push(...entry(row.code, descriptions, written));
      }
    }
    blocks.push(lines.join('\n'));
  }

  const header = [
    'PERMISSION CATALOGUE — input for the Arabic one-line descriptions',
    '',
    `${catalogue.length} permission codes, ${modules.length} modules. Generated from the seeded database by`,
    '`npm run db:permission-descriptions`, so this IS what the Role screen renders — not a separate',
    'list that can drift from it. Regenerate rather than hand-editing the structure: any line you have',
    'already written after `ar:` is carried forward by code and is never overwritten.',
    '',
    'HOW TO READ THIS',
    '  [5-STATE]  A CRUD-shaped family. The screen shows it as ONE row with its states side by side,',
    '             and its member codes are indented beneath it here. A description is still wanted per',
    '             CODE, because each state means something different to a person.',
    '  [toggle]   A single on/off permission. One description.',
    '',
    'WHAT IS WANTED: one short line per code, in Arabic, saying what holding it ALLOWS — what the',
    'person can then do on screen. Not the code restated.',
    '',
    'The "en:" line is the description already stored in the database. It is developer-facing and',
    'often terse: a hint, not something to translate.',
    '',
    'A code whose en: line begins NOT YET ENFORCED needs NO Arabic line. Holding it does nothing today',
    'and the screen says so — skip those rather than describing a capability that is not there.',
    '',
    BAR,
    '',
  ].join('\n');

  // The count of lines SHE has written is deliberately NOT part of the file.
  //
  // It was, for one run, and that was a defect: the content then depended on how much she had filled
  // in, so writing a single Arabic line made `--check` report STALE until a developer regenerated —
  // `verify.sh` going red because the owner did the work the file exists for. Found by writing a real
  // line into the real file and running the gate, not by reasoning about it. The bytes now depend only
  // on the catalogue and on her own lines, which is what makes `render(catalogue, harvest(file))`
  // equal `file` and keeps the gate quiet while she works. The count goes to stdout instead.
  const totals = [
    '',
    BAR,
    `TOTALS: ${families} five-state families covering ${familyCodes} codes, ${toggles} toggles, ${catalogue.length} codes in all.`,
    '',
  ].join('\n');

  return `${header}${blocks.join('\n\n')}${totals}`;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.permission.findMany({
      select: { code: true, module: true, description: true },
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
    if (rows.length === 0) {
      throw new Error(
        'The permission catalogue is empty. Run `npm run db:seed` — this file is a measurement of the seeded catalogue, and an empty one would hand her a document with nothing in it.',
      );
    }
    const catalogue = rows.map((p) => ({
      code: p.code,
      module: p.module,
      description: p.description ?? '',
    }));

    const existing = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    const written = harvestExistingArabic(existing);
    const content = render(catalogue, written);
    const carried = catalogue.filter((p) => written[p.code] !== undefined).length;

    if (CHECK_ONLY) {
      if (existing !== content) {
        // A written line that would not survive the regenerate. "Stale" is routine; "regenerating
        // would delete her work" is not, and the two must not print the same sentence.
        //
        // THIS DELIBERATELY DOES NOT ASK `harvestExistingArabic`. The first version did, and the
        // message was then unreachable in the one case that matters most: break the harvest and it
        // returns nothing, so there is nothing it can report as dropped — the worst failure printed
        // the mildest message. Proven by planting exactly that. A safety check may not be built out
        // of the component whose failure it exists to catch, so this reads the file directly.
        const dropped = writtenLinesIn(existing).filter((line) => !content.includes(line));
        console.error(
          `permission-descriptions input: STALE — ${OUT} does not match the seeded catalogue (${catalogue.length} codes).`,
        );
        if (dropped.length > 0) {
          console.error(
            `  AND regenerating would DROP ${dropped.length} Arabic line(s) somebody wrote. Fix the harvest before regenerating — do NOT run the write variant. First dropped: ${dropped[0]}`,
          );
        }
        console.error('  Regenerate it:  npm run db:permission-descriptions');
        process.exitCode = 1;
        return;
      }
      console.log(
        `permission-descriptions input: up to date (${catalogue.length} codes, ${carried} Arabic line(s) written).`,
      );
      return;
    }

    writeFileSync(OUT, content, 'utf8');
    console.log(
      `permission-descriptions input: wrote ${OUT} (${catalogue.length} codes, ${carried} Arabic line(s) carried forward).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// Not run when imported by the spec.
if (process.argv[1] !== undefined && process.argv[1].includes('generate-permission-descriptions-input')) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
