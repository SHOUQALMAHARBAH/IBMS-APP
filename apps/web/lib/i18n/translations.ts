// Part F — Bilingual UI (backlog Part 11), item #1 built the switch
// mechanism against a deliberately small 6-key dictionary (language switcher
// + nav account footer only). This file now merges that dictionary with the
// growing set of full-app translations, split into namespaced files under
// ./translations/ (one per screen/domain — common.ts for shared strings,
// nav.ts for the sidebar, leads.ts, customers.ts, ...). Splitting by domain
// avoids one unmanageable file and cuts merge-conflict risk when several
// screens are translated in the same round; this file's only job is
// re-exporting the merged, flat `TranslationKey` union every consumer
// already imports.
//
// Key naming: semantic key names (e.g. `leadsAddButton`), never the English
// phrase itself — unchanged from the original convention. Each domain file
// prefixes its own keys (`nav*`, `leads*`, `customers*`, ...) so the merged
// flat namespace never collides.
import { COMMON } from './translations/common';
import { NAV } from './translations/nav';
import { LEADS } from './translations/leads';
import { CUSTOMERS } from './translations/customers';
import { RFQ } from './translations/rfq';
import { POLICY } from './translations/policy';

export type Language = 'AR' | 'EN';

export const LANGUAGES: readonly Language[] = ['AR', 'EN'];

const translations = {
  AR: { ...COMMON.AR, ...NAV.AR, ...LEADS.AR, ...CUSTOMERS.AR, ...RFQ.AR, ...POLICY.AR },
  EN: { ...COMMON.EN, ...NAV.EN, ...LEADS.EN, ...CUSTOMERS.EN, ...RFQ.EN, ...POLICY.EN },
} as const;

export type TranslationKey = keyof (typeof translations)['EN'];

/** `params`, when given, substitutes `{name}`-style placeholders in the
 * resolved string — e.g. `t('leadsAddedMessage', { name: lead.fullName })`
 * for `Lead "{name}" added to your pipeline.` A key with no placeholders
 * ignores `params` entirely, so existing zero-arg call sites need no
 * change. */
export function translate(
  language: Language,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const raw = translations[language][key];
  if (!params) return raw;
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
    raw as string,
  );
}
