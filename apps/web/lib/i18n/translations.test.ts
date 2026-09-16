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
});
