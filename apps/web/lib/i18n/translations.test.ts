import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGES, translate } from './translations';
import { COMMON } from './translations/common';
import { AUTH } from './translations/auth';
import { NAV } from './translations/nav';
import { LEADS } from './translations/leads';
import { CUSTOMERS } from './translations/customers';
import { RFQ } from './translations/rfq';
import { POLICY } from './translations/policy';
import { COMPLAINTS } from './translations/complaints';
import { CUSTOMER_SERVICE } from './translations/customer-service';
import { PDPL } from './translations/pdpl';
import { FINANCE } from './translations/finance';
import { COMPLIANCE_SCREENING } from './translations/compliance-screening';
import { COMPLIANCE_RISK } from './translations/compliance-risk';
import { DASHBOARDS } from './translations/dashboards';
import { OPERATIONS } from './translations/operations';
import { DETAIL_PAGES } from './translations/detail-pages';
import { ENUMS } from './translations/enums';
import { INSURERS } from './translations/insurers';
import { PERMISSION_CATALOGUE } from '../../e2e/fixtures/role-permissions';

describe('translate', () => {
  it('returns the AR string for AR', () => {
    expect(translate('AR', 'language')).toBe('اللغة');
  });

  it('returns the EN string for EN', () => {
    expect(translate('EN', 'language')).toBe('Language');
  });

  it('has every key defined for every language', () => {
    const arKeys = Object.keys({
      language: translate('AR', 'language'),
      switchToArabic: translate('AR', 'switchToArabic'),
      switchToEnglish: translate('AR', 'switchToEnglish'),
      signOut: translate('AR', 'signOut'),
    });
    for (const key of arKeys) {
      for (const language of LANGUAGES) {
        expect(translate(language, key as Parameters<typeof translate>[1])).toBeTypeOf('string');
      }
    }
  });
});

// The merge in ./translations.ts spreads fifteen dictionaries into one flat
// namespace and relies on each file prefixing its own keys so nothing can
// collide. Nothing checked that, and four `commChannel*` keys were declared
// in both rfq.ts and customer-service.ts — the later spread won, so
// `rfqs/[id]` rendered the communications screen's "Phone call"/"Customer
// portal" instead of its own "Call"/"Portal", in Arabic too. A collision is
// invisible to `tsc`: both sides are the same type, and the merged object is
// simply the last writer's value. These two tests are that missing check.
describe('the merged dictionary', () => {
  const FILES: Record<string, { AR: Record<string, string>; EN: Record<string, string> }> = {
    'common.ts': COMMON,
    'auth.ts': AUTH,
    'nav.ts': NAV,
    'leads.ts': LEADS,
    'customers.ts': CUSTOMERS,
    'rfq.ts': RFQ,
    'policy.ts': POLICY,
    'complaints.ts': COMPLAINTS,
    'customer-service.ts': CUSTOMER_SERVICE,
    'pdpl.ts': PDPL,
    'finance.ts': FINANCE,
    'compliance-screening.ts': COMPLIANCE_SCREENING,
    'compliance-risk.ts': COMPLIANCE_RISK,
    'dashboards.ts': DASHBOARDS,
    'operations.ts': OPERATIONS,
    'detail-pages.ts': DETAIL_PAGES,
    'enums.ts': ENUMS,
    'insurers.ts': INSURERS,
  };

  // Without this, the map above silently under-covers the moment someone adds
  // a dictionary — which is exactly what happened when auth.ts was created:
  // the two checks below kept passing while ignoring the new file entirely.
  it('covers every dictionary file on disk', () => {
    const dir = path.join(__dirname, 'translations');
    const onDisk = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .sort();
    expect(Object.keys(FILES).sort()).toEqual(onDisk);
  });

  it('declares every key in exactly one dictionary', () => {
    const owners = new Map<string, string[]>();
    for (const [file, dict] of Object.entries(FILES)) {
      for (const key of Object.keys(dict.EN)) {
        owners.set(key, [...(owners.get(key) ?? []), file]);
      }
    }
    const collisions = [...owners].filter(([, files]) => files.length > 1);
    expect(
      collisions.map(([key, files]) => `${key}: ${files.join(' + ')}`),
    ).toEqual([]);
  });

  it('keeps every dictionary at exact AR/EN parity', () => {
    for (const [file, dict] of Object.entries(FILES)) {
      const ar = Object.keys(dict.AR).sort();
      const en = Object.keys(dict.EN).sort();
      expect(`${file}: ${ar.join(',')}`).toBe(`${file}: ${en.join(',')}`);
    }
  });

/**
 * A PERMISSION CODE QUOTED AT A USER MUST BE A PERMISSION THAT EXISTS.
 *
 * Renaming permissions in four-action Phase 1 left Arabic refusal messages naming codes that no longer
 * existed, twice in one change, while the English halves were corrected. Both were caught by Playwright
 * assertions on the ENGLISH text — the wrong way round for a product whose primary language is Arabic.
 * IMPROVEMENTS § 1.54.
 *
 * ## Why this check and not "the English changed and the Arabic did not"
 *
 * That one is expressible — diff both halves against the merge base, compare changed-key sets — and it was
 * rejected for two measured reasons. It fires on legitimate single-language edits (an English typo fix, an
 * Arabic phrasing improvement), so it needs an escape hatch, and with one it is a reminder rather than a
 * gate. And it is blind to the worse case: when a rename leaves BOTH languages stale, nothing changed, so
 * there is no asymmetry to find.
 *
 * This is language-symmetric by construction, catches stale-in-both, has no false-positive class for prose
 * edits, and needs no git plumbing. Note what it does NOT check: that the two halves MEAN the same thing.
 * Nothing can check that. It checks the machine-readable part of the meaning, which is the part that breaks
 * silently.
 */
describe('permission codes quoted in user-facing text', () => {
  /** A dotted machine identifier: `vendor.read`, `customer.360-view.read`. */
  const TOKEN = /[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+/g;

  /**
   * Dotted tokens that are NOT permission codes and may appear in user-facing text. Enumerated rather than
   * pattern-matched, so adding one is a decision — each is here because it was measured in the dictionaries.
   */
  const ALLOWED_NON_PERMISSION_TOKENS = new Set([
    // Latin abbreviations in guidance text.
    'e.g',
    'i.e',
    // A consent-notice VERSION, shown as a placeholder example on the consent screen. Measured, not
    // guessed: it was the only token the first run of this check flagged, in both languages.
    'privacy-notice-v1.2',
  ]);

  const CODES = new Set(PERMISSION_CATALOGUE.map((entry) => entry.code));

  for (const language of LANGUAGES) {
    it(`${language}: every permission-code-shaped token names a code that exists`, () => {
      const offenders: string[] = [];
      for (const [file, dictionary] of Object.entries(FILES)) {
        for (const [key, value] of Object.entries(dictionary[language])) {
          for (const token of value.match(TOKEN) ?? []) {
            if (CODES.has(token) || ALLOWED_NON_PERMISSION_TOKENS.has(token)) continue;
            offenders.push(`${file} ${language}.${key}: "${token}"`);
          }
        }
      }
      expect(
        offenders,
        'A dotted token in user-facing text matches no permission in the catalogue. Either the code was renamed and this message was not updated — the bug this test exists for, and the Arabic half is the one that gets missed — or it is not a permission and belongs in ALLOWED_NON_PERMISSION_TOKENS with a reason.',
      ).toEqual([]);
    });
  }

  it('actually finds codes to check, in BOTH languages, in comparable numbers', () => {
    // The non-vacuity half, and it is not ceremony: three plants in three days applied cleanly and killed
    // nothing because the surface could not observe them. An empty regex match, a catalogue that contained
    // everything, or a dictionary map that lost its files would each leave the tests above green.
    const counts: Record<string, number> = { AR: 0, EN: 0 };
    for (const language of LANGUAGES) {
      for (const dictionary of Object.values(FILES)) {
        for (const value of Object.values(dictionary[language])) {
          for (const token of value.match(TOKEN) ?? []) {
            if (CODES.has(token)) counts[language] += 1;
          }
        }
      }
    }
    // Measured before this was written: 82 distinct codes across 286 occurrences.
    expect(counts.AR, 'no permission codes found in the Arabic halves').toBeGreaterThan(50);
    expect(counts.EN, 'no permission codes found in the English halves').toBeGreaterThan(50);
    // And neither half quotes far fewer than the other — that asymmetry IS the bug class.
    const ratio =
      Math.min(counts.AR, counts.EN) / Math.max(counts.AR, counts.EN);
    expect(
      ratio,
      `AR ${counts.AR} vs EN ${counts.EN} — one language names codes the other does not`,
    ).toBeGreaterThan(0.8);
  });
});
});
