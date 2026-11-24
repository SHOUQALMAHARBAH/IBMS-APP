import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 🔴 OWNER DECISION 158 — THE DEMO DATA READS IN ARABIC, AND EVERY WORD IS HERS.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Her paper ratifies ten tables of text for `seed-demo.script.ts`. The seeder is a SCRIPT, not a
 * module, and nothing imports it — so without this the only thing standing between her words and
 * a later edit is that somebody remembers the paper exists.
 *
 * ## IT READS BOTH FILES OFF DISK AND COMPARES THEM
 *
 * ⛔ No Arabic is written here. Every expected string is SLICED from
 * `docs/decision-158-seed-arabic.md` at test time and looked for in the seeder's own source, so
 * a reword on either side fails with the row named. A test holding its own copy of her Arabic
 * would be a second home for it, and the first reword would leave the copy asserting the old
 * text while the seed shipped the new one.
 *
 * ## AND IT ASSERTS THE ENGLISH IS GONE, WHICH IS THE HALF THAT ROTS
 *
 * A presence check alone passes against a seeder carrying BOTH — which is exactly what a
 * half-finished sweep looks like, and exactly what an office would then see on a screen.
 */

const REPO = join(__dirname, '..', '..', '..');
const PAPER = join(REPO, 'docs', 'decision-158-seed-arabic.md');
const SEED = join(REPO, 'apps', 'api', 'scripts', 'seed-demo.script.ts');

const paper = readFileSync(PAPER, 'utf8');
const seed = readFileSync(SEED, 'utf8');

/** Her own `### <letter> — …` block, found by a fragment of its heading. */
function section(fragment: string): string {
  const heads = [...paper.matchAll(/^### (.+)$/gm)];
  const at = heads.findIndex((m) => m[1].includes(fragment));
  expect(
    at,
    `decision 158 has no section matching «${fragment}»`,
  ).toBeGreaterThan(-1);
  const start = heads[at].index + heads[at][0].length;
  const end = at + 1 < heads.length ? heads[at + 1].index : paper.length;
  return paper.slice(start, end);
}

/** The rows of a `| … | … |` table, header and separator dropped. */
function rows(block: string, width: number): string[][] {
  return block
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim()),
    )
    .filter((cells) => cells.length === width)
    .filter(
      (cells) =>
        !/^[-: ]*$/.test(cells[0]) &&
        !['اليوم', 'السطر', 'العنوان اليوم', ''].includes(cells[0]),
    );
}

/*
 * THE TEN TABLES, each named by the heading fragment that finds it and by which columns carry
 * the English that must be gone and the Arabic that must be there.
 *
 * ⚠️ `ك` IS NOT IN THIS LIST and has its own test below: its «اليوم» column holds the REAL
 * install's placeholder (`CBJ-SEED-…`), which must STAY in `packages/db/prisma/seed.ts` — so
 * asserting it absent from the repo would assert the opposite of her ruling.
 */
const TABLES: { heading: string; width: number; en: number; ar: number }[] = [
  { heading: 'أ — قطاعات', width: 2, en: 0, ar: 1 },
  { heading: 'ب — المسمّيات', width: 2, en: 0, ar: 1 },
  { heading: 'ج — ملفّ المخاطر', width: 3, en: 1, ar: 2 },
  { heading: 'هـ — مبرّر', width: 2, en: 0, ar: 1 },
  { heading: 'و — أوصاف', width: 2, en: 0, ar: 1 },
  { heading: 'ز — نصوص الشكاوى', width: 2, en: 0, ar: 1 },
  { heading: 'ح — الحوادث', width: 3, en: 0, ar: 1 },
  { heading: 'ط — المورّدون', width: 2, en: 0, ar: 1 },
  { heading: 'ي — أسماء حدود', width: 2, en: 0, ar: 1 },
];

describe('decision 158 — every ratified Arabic string is in the demo seeder', () => {
  it.each(TABLES)('table $heading', ({ heading, width, ar }) => {
    const table = rows(section(heading), width);
    // NON-VACUITY: an empty table would make every assertion below trivially true, and the
    // comparison would pass against a seeder nobody had touched.
    expect(table.length, `${heading} parsed no rows`).toBeGreaterThan(0);
    for (const cells of table) {
      expect(seed, `${heading}: «${cells[ar]}» is not in the seeder`).toContain(
        cells[ar],
      );
    }
  });
});

describe('decision 158 — and the English it replaced is gone', () => {
  /*
   * ⚠️ FIVE ROWS ARE EXCLUDED, EACH BY A MEASURED REASON RATHER THAN BECAUSE THEY FAILED.
   *
   *   `Office Administrator` — her table ب is the employee POSITION list, and the same words
   *       are also the demo ACTOR's `label:`, which the seeder prints in its own console tally
   *       for whoever runs it. That is not a word on a screen and she did not rule on it.
   *   `total` / `aggregate` / `perOccurrence` — ordinary English words that occur throughout
   *       this file as identifiers (`total` is a local variable in three other functions). The
   *       presence half above is what proves her keys landed; an absence check on the word
   *       «total» would be a check on the English language.
   *   `Small` — the same, in a COMMENT: «// Small helpers». Her row is the `businessSize`
   *       value, which is gone; the word is not.
   */
  const NOT_CHECKED_ABSENT = new Set([
    'Office Administrator',
    'total',
    'aggregate',
    'perOccurrence',
    'Small',
  ]);

  it.each(TABLES)(
    'table $heading leaves no English behind',
    ({ heading, width, en }) => {
      const table = rows(section(heading), width);
      const left = table
        .map((cells) => cells[en])
        .filter((value) => !NOT_CHECKED_ABSENT.has(value))
        .filter((value) => seed.includes(value));
      expect(
        left,
        `${heading}: these English values are still in the seeder`,
      ).toEqual([]);
    },
  );
});

describe('decision 158 ruling 1-ب — the nine insurer names STAY', () => {
  /*
   * «موافقة … بس نبلش بقاعدة فاضية» is a different ruling; THIS one is 1-ب: she was shown that
   * at least two of the nine are the names of real companies and ruled they stay as they are.
   *
   * ⛔ So this is pinned in the NOT-CHANGED direction. Without it, a later batch «finishing the
   * sweep» would translate them and nothing would fail.
   */
  it('the demo insurer list is still the English-and-Arabic pairs it was', () => {
    for (const name of [
      'Petra Takaful (demo)',
      'Yarmouk Insurance (demo)',
      'Zarqa Mutual (demo)',
    ]) {
      expect(
        seed,
        `${name} is one of the nine, and ruling 1-ب keeps it`,
      ).toContain(name);
    }
  });

  it('and the duplicate-spelling demonstration can still collide', () => {
    // Two of the nine are deliberately one company spelt two ways, which is what the insurer
    // directory's duplicate proof shows. Translating either half would end that.
    // Office B's second entry is office A's second company spelt differently — same canonical
    // key, two spellings — and that is what makes the cross-office directory show ONE company.
    expect(seed).toContain('Yarmouk Insurance (demo)');
    expect(seed).toContain('YARMOUK   insurance (demo)');
    // The two ARABIC spellings differ too, and ruling 1-ب keeps both.
    expect(seed).toContain('شركة اليرموك للتأمين');
    expect(seed).toContain('شركه اليرموك للتامين');
  });
});

describe('decision 158 table ك — the demo offices carry a demo licence number', () => {
  function rowK(label: string): string {
    const match = rows(section('ك — ترخيص'), 3).find((cells) =>
      cells[0].includes(label),
    );
    expect(match, `table ك has no row for «${label}»`).toBeDefined();
    return match![2];
  }

  it('both numbers and the scope text are the ones she chose', () => {
    for (const label of ['ناصر', 'الحياة', 'وصف نطاق']) {
      expect(seed).toContain(rowK(label));
    }
  });

  it('⛔ and the REAL install placeholder is untouched', () => {
    /*
     * Her «ما لا يتغيّر» section: «الزرع الأساسي للتنصيب الحقيقي: رقم الترخيص الافتراضي واسم
     * المكتب الافتراضي لا يُمَسّان». A demo word in `seed.ts` would stamp «تجريبي» on the
     * licence of every office anybody ever creates.
     */
    const baseSeed = readFileSync(
      join(REPO, 'packages', 'db', 'prisma', 'seed.ts'),
      'utf8',
    );
    expect(baseSeed).toContain('CBJ-SEED-');
    expect(baseSeed).toContain(
      'Seeded placeholder — general insurance brokerage',
    );
    for (const label of ['ناصر', 'الحياة', 'وصف نطاق']) {
      expect(
        baseSeed,
        'a demo value reached the real install seed',
      ).not.toContain(rowK(label));
    }
  });
});
