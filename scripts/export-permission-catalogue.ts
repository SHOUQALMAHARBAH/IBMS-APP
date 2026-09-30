/**
 * Writes `docs/permission-catalogue.md` — the full permission catalogue with the roles that hold each code.
 *
 * ## Why this is generated and not written
 *
 * The owner writes the Arabic descriptions and has no repository access, so she is reading a file rather
 * than measuring the system. A hand-listed catalogue would drift from the seeded one the first time a code
 * was added — which has now happened twice in one week (`customer.read`, `diagnostics.view`) — and she would
 * have no way to tell. This reads the SEEDED DATABASE, so the list is what the Role screen actually renders.
 *
 * ## Why it carries the ROLES and the descriptions file does not
 *
 * `docs/permission-catalogue-for-descriptions.txt` is the input file she types into; it groups codes by
 * [5-STATE]/[toggle] because that is how the screen renders them. This one answers a different question —
 * *who holds this today* — because a description is easier to write when you know who is reading it. A code
 * held by one role is described differently from one held by ten.
 *
 * The role names here are the SEEDED ones. An office defines its own roles under its own names, so these
 * are the eleven the system ships with plus `OFFICE_ADMINISTRATOR`, not a fixed vocabulary.
 *
 * Usage:  npx dotenv -e .env.test -- npx tsx scripts/export-permission-catalogue.ts
 */
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const OUT = 'docs/permission-catalogue.md';

/** Arabic module labels, so each section names itself in the language the descriptions are written in. */
const MODULE_AR: Record<string, string> = {
  admin: 'الإدارة والأمن',
  claims: 'المطالبات',
  'commercial-front-office': 'المكتب الأمامي التجاري',
  'compliance-risk': 'الالتزام والمخاطر',
  customer: 'العملاء',
  'customer-service': 'خدمة العملاء',
  finance: 'المالية',
  'insurance-operations': 'العمليات التأمينية',
  'management-reporting': 'التقارير الإدارية',
  pdpl: 'حماية البيانات الشخصية',
  sla: 'مستويات الخدمة',
  'supporting-operations': 'العمليات المساندة',
};

/**
 * One cell of a markdown table, escaped so its content cannot end the cell.
 *
 * THE ORDER IS THE WHOLE POINT, and getting it wrong is what CodeQL flagged here (alert 3, high):
 * escaping `|` alone turns a backslash-then-pipe into `\` + `\|` — an ESCAPED BACKSLASH followed by a
 * LIVE pipe, so the cell ends early and everything after it shifts into the next column. The backslash
 * has to be escaped FIRST, before anything that emits one.
 *
 * Newlines are collapsed rather than escaped, because a newline inside a cell does not break the cell,
 * it breaks the ROW — markdown tables are line-oriented, so the remainder becomes a malformed table row.
 *
 * No seeded description contains either today (measured). That is exactly why it is worth fixing rather
 * than arguing about: nothing would have failed, and the first description someone writes with a Windows
 * path or a regex in it would silently corrupt the table the owner reads to decide grants.
 */
function markdownCell(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.permission.findMany({
      select: {
        code: true,
        module: true,
        description: true,
        roles: { select: { role: { select: { name: true } } } },
      },
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });

    if (rows.length === 0) {
      throw new Error(
        'The permission catalogue is empty. Run `npm run db:seed` first — this file is a measurement of the seeded catalogue, and an empty one would hand her a document with nothing in it.',
      );
    }

    const byModule = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byModule.get(row.module) ?? [];
      list.push(row);
      byModule.set(row.module, list);
    }

    const lines: string[] = [];
    lines.push('# Permission catalogue — دليل الصلاحيات');
    lines.push('');
    lines.push(
      `> **${rows.length} permission codes across ${byModule.size} modules.** Generated from the seeded ` +
        'database by `npx tsx scripts/export-permission-catalogue.ts`, so this is what the Role screen ' +
        'actually renders — not a separate list that can drift from it.',
    );
    lines.push('>');
    lines.push(
      '> **The English text is the stored description.** It is developer-facing and often terse: a hint ' +
        'at what the code gates, not something to translate word for word.',
    );
    lines.push('>');
    lines.push(
      '> **"Held by" is the SEEDED roles.** An office defines its own roles under its own names, so these ' +
        'are the eleven the system ships with plus `OFFICE_ADMINISTRATOR` — a starting grid, not a fixed ' +
        'vocabulary. A code held by one role is described differently from one held by ten, which is why ' +
        'this column is here.',
    );
    lines.push('>');
    lines.push(
      '> **A code held by NO role is not a mistake.** It means the seeded grid grants it to nobody yet; ' +
        'an office can still grant it from the Role screen.',
    );
    lines.push('');

    for (const module of [...byModule.keys()].sort()) {
      const list = byModule.get(module)!;
      const ar = MODULE_AR[module] ?? module;
      lines.push(`## ${module} — ${ar}  (${list.length})`);
      lines.push('');
      lines.push('| Code | English description (stored) | Held by |');
      lines.push('|---|---|---|');
      for (const row of list) {
        // ESCAPED TOO, and this is the reachable half rather than the flagged one. CodeQL traced the
        // description because it is a plain column; a ROLE NAME is office-authored — since Phase 3 an
        // administrator types it at `/settings/roles` — so `Finance | Ops` is a name somebody can
        // actually create, and it would shift every later column of that row.
        const holders = [...new Set(row.roles.map((r) => markdownCell(r.role.name)))].sort();
        const held = holders.length > 0 ? holders.join(', ') : '_(no seeded role)_';
        const desc = markdownCell(row.description ?? '') || '_(none stored)_';
        lines.push(`| \`${row.code}\` | ${desc} | ${held} |`);
      }
      lines.push('');
    }

    const heldCounts = rows.map((r) => new Set(r.roles.map((x) => x.role.name)).size);
    lines.push('---');
    lines.push('');
    lines.push('## Measured, so the numbers are checkable');
    lines.push('');
    lines.push(`- **${rows.length}** codes, **${byModule.size}** modules.`);
    lines.push(
      `- **${heldCounts.filter((n) => n === 0).length}** held by no seeded role; ` +
        `**${heldCounts.filter((n) => n === 1).length}** held by exactly one.`,
    );
    lines.push(
      `- **${rows.filter((r) => !r.description).length}** have no stored English description.`,
    );
    lines.push('');
    lines.push(
      'Regenerate after any permission change. The sibling file ' +
        '`docs/permission-catalogue-for-descriptions.txt` is the one to TYPE INTO — it carries an `ar:` line ' +
        'per code and is regenerated without destroying what is already written there.',
    );
    lines.push('');

    writeFileSync(OUT, lines.join('\n'), 'utf8');
    console.log(
      `permission catalogue: wrote ${OUT} (${rows.length} codes, ${byModule.size} modules, ` +
        `${heldCounts.filter((n) => n === 0).length} held by no seeded role).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
