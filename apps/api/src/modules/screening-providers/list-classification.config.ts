import type { ScreeningListType } from './screening-provider.types';

/**
 * WHICH LIST a screening candidate came from.
 *
 * ## Why this is a registry and not a substring test
 *
 * The first implementation asked whether the dataset name contained the word
 * "sanction". That is wrong on the two most important datasets this system
 * will ever see: `us_ofac_sdn` and `eu_fsf` are both sanctions lists and
 * neither contains the word. They were classified as generic `WATCHLIST`,
 * which UNDERSTATES a sanctions hit — the direction that matters, because a
 * sanctions match carries obligations a watchlist match does not.
 *
 * Substring matching also fails in the other direction: a dataset named
 * `no_sanctions_screening_notes` would have been classified as sanctions.
 *
 * So classification is an EXPLICIT MAPPING. An identifier this table does not
 * know is `WATCHLIST` and is reported as unrecognised, so an operator can add
 * it — rather than being silently guessed into a category with legal
 * consequences.
 *
 * ## Precedence
 *
 *  1. The provider's own topic tags (`sanction`, `role.pep`) — authoritative,
 *     because that is the provider stating what the entity IS.
 *  2. This registry, matched on the NORMALISED dataset identifier.
 *  3. `WATCHLIST`, with the identifier reported as unrecognised.
 *
 * Never inferred: a candidate is only PEP when something authoritative says
 * so. Calling somebody politically exposed when the data does not say it is
 * fabricating a determination about a real person.
 */

/** Lower-case, and collapse separators so `us-ofac-sdn`, `us_ofac_sdn` and
 * `US OFAC SDN` are one identifier. Does not otherwise alter the string. */
export function normalizeDatasetId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Known dataset identifiers.
 *
 * Sources: this repository's own `WatchlistSource` enum, and the OpenSanctions
 * dataset identifiers a yente deployment exposes. Entries are added only for
 * datasets whose classification is unambiguous — an unfamiliar identifier is
 * meant to fall through to `WATCHLIST` and be reported, not guessed.
 */
export const DATASET_LIST_TYPES: Readonly<Record<string, ScreeningListType>> = {
  // --- this repository's own synced sources -------------------------------
  ofac_sdn: 'SANCTIONS',
  un_consolidated: 'SANCTIONS',

  // --- OpenSanctions / yente: sanctions -----------------------------------
  us_ofac_sdn: 'SANCTIONS',
  us_ofac_cons: 'SANCTIONS',
  eu_fsf: 'SANCTIONS',
  un_sc_sanctions: 'SANCTIONS',
  gb_hmt_sanctions: 'SANCTIONS',
  ch_seco_sanctions: 'SANCTIONS',
  ca_dfatd_sema_sanctions: 'SANCTIONS',
  au_dfat_sanctions: 'SANCTIONS',
  // OpenSanctions' own aggregate sanctions collection.
  sanctions: 'SANCTIONS',

  // --- OpenSanctions / yente: politically exposed persons -----------------
  // Only identifiers that unambiguously denote PEP data. Anything doubtful is
  // deliberately absent.
  peps: 'PEP',
  wd_peps: 'PEP',
  everypolitician: 'PEP',
  us_cia_world_leaders: 'PEP',

  // --- other watchlists ---------------------------------------------------
  debarment: 'WATCHLIST',
  wanted: 'WATCHLIST',
  interpol_red_notices: 'WATCHLIST',
};

/** Topic tags a provider may attach to an entity. Authoritative: this is the
 * provider classifying its own data rather than us inferring from a name. */
const TOPIC_LIST_TYPES: readonly { topic: string; type: ScreeningListType }[] =
  [
    { topic: 'sanction', type: 'SANCTIONS' },
    { topic: 'role.pep', type: 'PEP' },
    { topic: 'poi', type: 'WATCHLIST' },
    { topic: 'debarment', type: 'WATCHLIST' },
    { topic: 'crime', type: 'WATCHLIST' },
  ];

export interface ListClassification {
  listType: ScreeningListType;
  /** How the answer was reached — surfaced so a reviewer can weigh it, and so
   * an unrecognised dataset is visible rather than silently defaulted. */
  basis: 'topic' | 'dataset' | 'unrecognised';
  /** Dataset identifiers this table did not know. Empty unless `basis` is
   * `unrecognised`. */
  unrecognisedDatasets: string[];
}

/**
 * Classify one candidate.
 *
 * `topics` wins because it is the provider's own statement. Datasets are
 * checked next, most-specific-first is irrelevant here because matching is
 * exact rather than prefix-based. A candidate carrying several datasets is
 * classified SANCTIONS if any of them is a sanctions list — the strongest
 * applicable category, since under-reporting is the harmful direction.
 */
export function classifyList(input: {
  topics?: readonly string[];
  datasets?: readonly string[];
}): ListClassification {
  const topics = (input.topics ?? []).map((t) => t.trim().toLowerCase());
  for (const { topic, type } of TOPIC_LIST_TYPES) {
    if (topics.includes(topic)) {
      return { listType: type, basis: 'topic', unrecognisedDatasets: [] };
    }
  }

  const datasets = (input.datasets ?? [])
    .map(normalizeDatasetId)
    .filter(Boolean);
  const known = datasets
    .map((id) => DATASET_LIST_TYPES[id])
    .filter((t): t is ScreeningListType => t !== undefined);

  if (known.length > 0) {
    // Strongest category wins: SANCTIONS > PEP > WATCHLIST. Under-reporting a
    // sanctions hit is the failure this ordering prevents.
    const listType: ScreeningListType = known.includes('SANCTIONS')
      ? 'SANCTIONS'
      : known.includes('PEP')
        ? 'PEP'
        : 'WATCHLIST';
    return { listType, basis: 'dataset', unrecognisedDatasets: [] };
  }

  return {
    listType: 'WATCHLIST',
    basis: 'unrecognised',
    unrecognisedDatasets: datasets,
  };
}

/** Every identifier the registry knows, for the health/coverage view and for
 * the test that pins the mapping. */
export function knownDatasetIds(): string[] {
  return Object.keys(DATASET_LIST_TYPES).sort();
}
