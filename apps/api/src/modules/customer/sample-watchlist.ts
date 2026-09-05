/**
 * Process 3-4 (Customer Acquisition/Onboarding) — "Run sanctions/PEP/AML
 * screening". No real sanctions/PEP/AML data provider exists or is
 * obtainable in this environment (same category of gap as A.1's "no SSO
 * identity provider" — see README § Known gaps, Part C #3-4). This is a
 * fictional, dev/test-only watchlist so the SCREENING -> EDD branch
 * (`ScreeningService`) is genuinely exercisable end-to-end rather than
 * being permanently unreachable dead code.
 *
 * Deliberately NOT a database table/seed row: nothing here is real
 * reference data a broker would configure — it is a hardcoded fixture a
 * real integration would replace wholesale, not extend. Matching against it
 * is a simple case-insensitive substring check, not a fuzzy/fingerprint
 * match a real sanctions screening product would use.
 *
 * Hard-gated on `NODE_ENV !== 'production'` — same convention as
 * `SAMPLE_INSURERS`/`SAMPLE_USERS` (packages/db/prisma/seed-data/) —
 * ScreeningService.run() always returns CLEAR results in a production
 * environment until a real provider is integrated (never a HIT it can't
 * substantiate).
 */
export const SAMPLE_WATCHLIST_ENABLED = process.env.NODE_ENV !== 'production';

export interface SampleWatchlistEntry {
  name: string;
  listSource: string;
}

export const SAMPLE_WATCHLIST: readonly SampleWatchlistEntry[] = [
  {
    name: 'Zayd Al-Muraqib',
    listSource: 'Sample UN Consolidated List (fixture)',
  },
  {
    name: 'Sample Sanctioned Trading Co.',
    listSource: 'Sample OFAC SDN List (fixture)',
  },
  { name: 'Fahd Al-Siyasi', listSource: 'Sample Local PEP Register (fixture)' },
];

/** Case-insensitive substring match against the fixture list above. Never
 * called outside `ScreeningService` — see that file for the CLEAR/HIT
 * decision this feeds into. */
export function matchesSampleWatchlist(
  name: string,
): SampleWatchlistEntry | null {
  if (!SAMPLE_WATCHLIST_ENABLED) return null;
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  return (
    SAMPLE_WATCHLIST.find((entry) =>
      normalized.includes(entry.name.toLowerCase()),
    ) ?? null
  );
}
