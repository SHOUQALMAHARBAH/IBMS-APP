import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSION_CATALOGUE } from '../../e2e/fixtures/role-permissions';
import { OPERATIONS } from '../i18n/translations/operations';
import { familyOf, verbOf } from './permission-matrix';
import {
  FAMILY_VERB_SEPARATOR,
  PERMISSION_FAMILY_NAMES,
  PERMISSION_NAMES,
  familyDisplayName,
  permissionDisplayName,
  permissionNameAr,
} from './permission-names';

/**
 * 🔴 OWNER DECISION 127 — THE 196 PERMISSION NAMES, RE-SLICED FROM HER THREE PAPERS.
 *
 * Every name that ships is ratified, and this file proves it by cutting all 196 out of the
 * papers AT TEST TIME and comparing byte for byte. ⛔ Nothing here is retyped: a test holding
 * its own copy of her Arabic is a second home for it, free to agree with a drifted product
 * while both have drifted away from her.
 *
 * ## The three sources, and why there are three
 *
 *   §٢ of annex 144   21 family names.
 *   §٣ of annex 144   174 rows — but TWO of them are superseded, see below.
 *   decision 146      `prospect.capture` and `prospect.read`. Decision 146 corrected the
 *                     descriptions those two names are sliced FROM («مرشَّح مؤهَّل» ⟶
 *                     «عميل مرتقب»), so annex 144's rows 4 and 5 now name a phrase the
 *                     product no longer says. 146 states the two corrected names itself.
 *   decision 145      `license-renewal.declare`, which annex 144 has no row for at all: the
 *                     code did not exist when 144 was written, and 145 ratified its name
 *                     BEFORE it shipped.
 *
 * 175 singles + 21 families = 196; 175 + the 59 codes a family row covers = the 234 catalogue
 * codes, with none left over in either direction.
 */

const REPO = join(__dirname, '..', '..', '..', '..');
const ANNEX_144 = join(REPO, 'docs', 'decision-144-ratified-strings.md');
const ANNEX_146 = join(REPO, 'docs', 'decision-146-ratified-strings.md');
const DECISION_145 = join(
  REPO,
  'docs',
  'decision-145-renewal-permission-words-and-attach-failure.md',
);
const DECISION_156 = join(
  REPO,
  'docs',
  'decision-156-date-shape-bell-sentence-deactivate-word.md',
);

/** A `## N — …` section of one of her papers, up to the next `## `. */
function section(body: string, heading: string): string {
  const at = body.indexOf(heading);
  if (at === -1) throw new Error(`heading not found: ${heading}`);
  const rest = body.slice(at + heading.length);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

/** The 21 family names, sliced from annex 144 §٢. */
function sliceFamilyNames(): Map<string, string> {
  const body = readFileSync(ANNEX_144, 'utf8');
  const rows = section(body, '## ٢ — ').matchAll(
    /^\| \d+ \| `([^`]+)` \| ([^|]+?) \| `[^`]+` \| [^|]+? \|$/gm,
  );
  const out = new Map<string, string>();
  for (const row of rows) out.set(row[1], row[2].trim());
  return out;
}

/** The 175 single names: annex 144 §٣, with 146's two and 145's one applied over it. */
function sliceSingleNames(): Map<string, string> {
  const body = readFileSync(ANNEX_144, 'utf8');
  const rows = section(body, '## ٣ — ').matchAll(
    /^\| \d+ \| `([^`]+)` \| ([^|]+?) \| [^|]+? \|$/gm,
  );
  const out = new Map<string, string>();
  for (const row of rows) out.set(row[1], row[2].trim());

  const corrected = readFileSync(ANNEX_146, 'utf8').match(
    /\*\*واسما الصلاحيتين في ملحق القرار ١٤٤ يتبعان الشرح بعد تصحيحه:\*\* «([^»]+)» و«([^»]+)»/,
  );
  if (!corrected)
    throw new Error('decision 146 does not state the two corrected names');
  out.set('prospect.capture', corrected[1]);
  out.set('prospect.read', corrected[2]);

  const declare = readFileSync(DECISION_145, 'utf8').match(
    /^\| اسم الصلاحية `license-renewal\.declare` \| ([^|]+?) \|$/m,
  );
  if (!declare)
    throw new Error('decision 145 does not state the declaration name');
  out.set('license-renewal.declare', declare[1].trim());

  return out;
}

const CODES = PERMISSION_CATALOGUE.map((entry) => entry.code);

describe('owner decision 127 — the permission names are hers, byte for byte', () => {
  it('ships exactly 21 family names and 175 single names: 196', () => {
    expect(Object.keys(PERMISSION_FAMILY_NAMES)).toHaveLength(21);
    expect(Object.keys(PERMISSION_NAMES)).toHaveLength(175);
    expect(
      Object.keys(PERMISSION_FAMILY_NAMES).length +
        Object.keys(PERMISSION_NAMES).length,
    ).toBe(196);
  });

  it('every one of the 21 family names is annex 144 §٢, byte for byte', () => {
    const sliced = sliceFamilyNames();
    expect(sliced.size).toBe(21);
    for (const [family, name] of sliced) {
      expect(
        PERMISSION_FAMILY_NAMES[family],
        `family «${family}»: re-slice from docs/decision-144-ratified-strings.md §٢ ` +
          'rather than editing it here.',
      ).toBe(name);
    }
    // and nothing extra has been added beside hers
    expect(Object.keys(PERMISSION_FAMILY_NAMES).sort()).toEqual(
      [...sliced.keys()].sort(),
    );
  });

  it('every one of the 175 single names is hers, byte for byte', () => {
    const sliced = sliceSingleNames();
    expect(sliced.size).toBe(175);
    for (const [code, name] of sliced) {
      expect(
        PERMISSION_NAMES[code],
        `«${code}»: re-slice from her paper rather than editing it here.`,
      ).toBe(name);
    }
    expect(Object.keys(PERMISSION_NAMES).sort()).toEqual(
      [...sliced.keys()].sort(),
    );
  });

  /*
   * NON-VACUITY FOR THE TWO OVERRIDES. Decision 146's names must actually DIFFER from annex
   * 144's rows 4 and 5 — otherwise «146 supersedes those rows» would be the identity function
   * and this file would silently be pinning the pre-146 text while claiming otherwise.
   */
  it("decision 146's two names really do replace annex 144's rows, not repeat them", () => {
    const body = readFileSync(ANNEX_144, 'utf8');
    const rows = new Map<string, string>();
    for (const row of section(body, '## ٣ — ').matchAll(
      /^\| \d+ \| `([^`]+)` \| ([^|]+?) \| [^|]+? \|$/gm,
    )) {
      rows.set(row[1], row[2].trim());
    }
    for (const code of ['prospect.capture', 'prospect.read'] as const) {
      expect(
        rows.get(code),
        `annex 144 §٣ has no row for ${code}`,
      ).toBeTruthy();
      expect(
        PERMISSION_NAMES[code],
        `${code}: decision 146's name is identical to annex 144's, so the override proves nothing`,
      ).not.toBe(rows.get(code));
      // and the struck phrase is gone from the shipping name
      expect(PERMISSION_NAMES[code]).not.toContain('مرشَّح مؤهَّل');
      expect(PERMISSION_NAMES[code]).not.toContain('المرشَّحين المؤهَّلين');
    }
  });

  it('license-renewal.declare takes its name from decision 145, not from annex 144', () => {
    const body = readFileSync(ANNEX_144, 'utf8');
    expect(
      section(body, '## ٣ — '),
      'annex 144 §٣ now has a row for license-renewal.declare — read it from there instead',
    ).not.toContain('`license-renewal.declare`');
    expect(PERMISSION_NAMES['license-renewal.declare']).toBeTruthy();
  });

  it('covers every catalogue code, by its own name or by its family', () => {
    const uncovered = CODES.filter(
      (code) =>
        !PERMISSION_NAMES[code] && !PERMISSION_FAMILY_NAMES[familyOf(code)],
    );
    expect(
      uncovered,
      'a catalogue code with no name would render its code',
    ).toEqual([]);

    // and no name exists for a code the catalogue does not have
    const orphans = Object.keys(PERMISSION_NAMES).filter(
      (code) => !CODES.includes(code),
    );
    expect(
      orphans,
      'a name for a code that does not exist is a stale row',
    ).toEqual([]);

    // 175 of the 234 carry their own name; the other 59 are family rows
    expect(CODES.filter((c) => PERMISSION_NAMES[c])).toHaveLength(175);
    expect(CODES.filter((c) => !PERMISSION_NAMES[c])).toHaveLength(59);
  });
});

describe('owner decision 127 — no permission code reaches an Arabic reader', () => {
  it('names every catalogue code in Arabic, and never renders the code', () => {
    for (const code of CODES) {
      const shown = permissionDisplayName(code, 'AR');
      expect(shown, `${code} renders its own code in Arabic`).not.toBe(code);
      expect(shown.trim().length).toBeGreaterThan(0);
      // a dotted machine identifier cannot survive in the rendered name
      expect(
        shown,
        `${code}'s Arabic name contains a latin letter`,
      ).not.toMatch(/[A-Za-z]/);
    }
  });

  it('composes a family code as «الاسم · الفعل», from the matrix’s own verb words', () => {
    // `customer.read` has no single name: it is one of the 59 a family row covers.
    expect(PERMISSION_NAMES['customer.read']).toBeUndefined();
    const expected =
      PERMISSION_FAMILY_NAMES['customer'] +
      FAMILY_VERB_SEPARATOR +
      OPERATIONS.AR.roleVerbView;
    expect(permissionNameAr('customer.read')).toBe(expected);
    expect(verbOf('customer.read')).toBe('read');
  });

  /*
   * ⛔ ENGLISH IS AN EMPTY CELL AND THIS PINS IT AS ONE. Every ratified name is Arabic and no
   * ruling covers English, so English renders exactly what it rendered before: the code. If a
   * later decision rules English names, this test is what has to be changed deliberately.
   */
  it('renders the CODE in English, because no English name is ruled', () => {
    for (const code of CODES)
      expect(permissionDisplayName(code, 'EN')).toBe(code);
    expect(familyDisplayName('customer', 'EN')).toBe('customer');
  });

  it('falls back to the code for a code the catalogue does not have', () => {
    expect(permissionNameAr('not.a.real.code')).toBe('not.a.real.code');
  });
});

describe('owner decision 156 ruling 3 — one word for one act on the roles screen', () => {
  /** The four rows of her continuation table, re-sliced from the decision itself. */
  function slicedRow(key: string): string {
    const body = readFileSync(DECISION_156, 'utf8');
    const row = body.match(
      new RegExp(
        `^\\| \`${key}\` \\| [^|]+ \\| [^|]+ \\| \\*\\*([^*|]+)\\*\\* \\|`,
        'm',
      ),
    );
    if (!row) throw new Error(`decision 156 states no new text for ${key}`);
    return row[1].trim();
  }

  it('«تعطيل» replaces «تقاعد» in all four strings, as she ratified them', () => {
    // ruling 3's own row states the verb without the continuation table's bold
    expect(OPERATIONS.AR.roleVerbDeactivate).toBe('تعطيل');
    expect(OPERATIONS.AR.roleRetireButton).toBe(slicedRow('roleRetireButton'));
    expect(OPERATIONS.AR.roleStatusInactive).toBe(
      slicedRow('roleStatusInactive'),
    );
    expect(OPERATIONS.AR.roleSystemExplain).toContain(
      slicedRow('roleSystemExplain'),
    );
  });

  it('renders her full ratified sentence for roleSystemExplain, byte for byte', () => {
    const body = readFileSync(DECISION_156, 'utf8');
    const full = body.match(
      /\*\*النصّ الكامل للجملة بعد القرار:\*\* «([^»]+)»/,
    );
    expect(
      full,
      'decision 156 no longer states the full sentence',
    ).toBeTruthy();
    expect(OPERATIONS.AR.roleSystemExplain).toBe(full?.[1]);
  });

  it('no Arabic `role*` string says «تقاعد» any more', () => {
    for (const [key, value] of Object.entries(OPERATIONS.AR)) {
      if (!key.startsWith('role')) continue;
      expect(value, `${key} still says «تقاعد»`).not.toContain('تقاعد');
    }
  });

  /*
   * ⛔ THE ENCRYPTION KEY IS A DIFFERENT THING, and her own paper says so: «و«متقاعد» لمفتاح
   * التشفير … معنى آخر، ولا يدخل». Pinned in the KEPT direction so a later tidy-up that
   * "finishes the sweep" fails here by name.
   */
  it('keeps «متقاعد» for a retired encryption key', () => {
    expect(OPERATIONS.AR.secKeysRetired).toContain('متقاعد');
  });

  /* ⛔ And the English half is unruled: «Retire» stays until a decision moves it. */
  it('leaves the English half exactly as it was', () => {
    expect(OPERATIONS.EN.roleVerbDeactivate).toBe('Retire');
  });
});
