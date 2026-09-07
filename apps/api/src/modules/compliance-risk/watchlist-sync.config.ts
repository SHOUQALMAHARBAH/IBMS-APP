/**
 * Process 49 — Sanctions & PEP Screening (backlog Part C #49, Domain F). The
 * pure, deterministic core: name canonicalisation (shared by ingestion and
 * match-time lookup) and the two free public sanctions-list parsers.
 *
 * OFAC SDN (https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/
 * exports/sdn.csv, redirected from the classic treasury.gov URL) and the UN
 * Security Council Consolidated List
 * (https://scsanctions.un.org/resources/xml/en/consolidated.xml) are both
 * free, government-published, no API key required — genuinely different from
 * `apps/api/src/modules/customer/sample-watchlist.ts`'s fictional dev/test
 * fixture, which stays in place for deterministic, offline unit/e2e testing
 * (see that file's own header). `ScreeningService` checks both: the fixture
 * (non-production only) and this real, synced list (every environment).
 *
 * `ibms-brain/meta/context/sanctions-pep-screening.md`.
 */

/**
 * Canonical form for name matching: uppercase, strip everything but
 * Unicode letters/digits/whitespace (so "AL ZAWAHIRI, Dr. Ayman" and "Ayman
 * Al-Zawahiri" both reduce to comparable token sets), collapse whitespace,
 * sort the tokens. Applied identically at ingestion time
 * (`WatchlistEntry.normalizedName`) and at match time (a customer/UBO name) —
 * an exact string match on this canonical form is the whole comparison.
 *
 * **Unicode-aware on purpose, not `[A-Z0-9]`** — a `@code-reviewer` BLOCKER
 * on the first pass: an ASCII-only character class reduces ANY name written
 * entirely in a non-Latin script (Arabic, for this Jordan-based broker,
 * whose `Customer.languagePreference` defaults to `AR`) to the empty
 * string. An empty `normalizedName` is not "no match" — every empty-string
 * customer/UBO name and every empty-string watchlist entry would then
 * collide with EVERY OTHER empty-string name, a universal false-positive
 * wildcard. `\p{L}`/`\p{N}` (the `u` flag) keep Arabic/Cyrillic/CJK/etc.
 * letters as real, distinguishing characters instead of stripping them.
 * This narrows, but does not eliminate, the empty-string risk (a name of
 * pure punctuation/whitespace still normalizes to `""`) — both call sites
 * (`WatchlistSyncService` at ingestion, `ScreeningService` at match time)
 * additionally refuse an empty normalized name outright; see there.
 *
 * **Not fuzzy or phonetic** — a documented limitation, the same honesty this
 * codebase already gives the fixture matcher ("a simple case-insensitive
 * substring check, not a fuzzy/fingerprint match a real sanctions screening
 * product would use"). Token-sorting buys tolerance for name-order and
 * comma/punctuation differences (which real sanctions lists are full of) at
 * effectively no engineering cost; it does not buy tolerance for spelling
 * variants, transliteration differences, or missing/extra middle names —
 * OFAC/UN publish names in Latin-script (English) transliteration even for
 * non-Latin-script individuals, so an Arabic-script customer name will
 * still rarely match a Latin-transliterated sanctions entry in practice; a
 * real screening product handles this with phonetic or edit-distance
 * algorithms this module does not implement. A SHARPER edge of the same
 * limitation: a real UN entity is listed under the single token "ADF"
 * (`watchlist-sync.config.spec.ts`'s own fixture) — any customer/UBO whose
 * legal name normalizes to exactly one short token collides on an exact
 * full-string match the same as a longer name would, with no lower-
 * confidence tier in between (`ScreeningOutcome.PENDING_INVESTIGATION`
 * exists on the model but this module does not use it) — noted here as a
 * known, accepted MINOR, not fixed.
 */
export function normalizeWatchlistName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** `WatchlistSyncService`'s plausibility floor before it will trust a
 * fresh parse enough to prune the existing cache against it — a
 * `@code-reviewer` BLOCKER on the first pass had no such check at all. If
 * there is a prior successful sync, the new count must be at least this
 * fraction of it; OFAC/UN lists only ever grow or hold steady in practice,
 * so a drastic drop is a fetch/parse failure, not a real list shrink. */
export const WATCHLIST_MIN_ACCEPTABLE_RATIO = 0.5;
/** The floor when there is no prior successful sync to compare against
 * (the very first sync ever) — a sanity check against an empty/near-empty
 * parse succeeding "for free" on day one. */
export const WATCHLIST_MIN_ABSOLUTE_RECORDS = 10;

export interface ParsedWatchlistRecord {
  sourceRecordId: string;
  fullName: string;
  listProgram: string | null;
  remarks: string | null;
}

// ---------------------------------------------------------------------------
// OFAC SDN CSV — no header row, 12 fixed columns, mixed quoted/unquoted
// fields (a filler placeholder "-0- " is never quoted, a real value always
// is): ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign, Vess_type,
// Tonnage, GRT, Vess_flag, Vess_owner, Remarks.
// ---------------------------------------------------------------------------

const OFAC_SDN_PLACEHOLDER = '-0-';

/** A single CSV line, respecting double-quoted fields (which may contain
 * commas) and doubled-quote escaping (`""` -> a literal `"`) — the general
 * CSV grammar, not specific to OFAC's file. Trailing/leading whitespace on
 * an unquoted field is trimmed; a quoted field's content is taken verbatim
 * (aside from the escape).
 *
 * Returns `null` for a line with an unterminated quote (an open `"` that
 * never closes before end-of-line) — a `@code-reviewer` MINOR on the first
 * pass: the naive state machine below simply left `inQuotes` true and
 * returned whatever had accumulated, silently merging every subsequent
 * comma-delimited field into one garbled value instead of surfacing the
 * line as unparseable. A single stray `"` in a `Remarks`/name field (this
 * is a name-and-remarks list, not machine-generated data) would previously
 * corrupt that one row's fields rather than being rejected outright. */
export function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (inQuotes) return null;
  fields.push(current.trim());
  return fields;
}

function ofacField(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === OFAC_SDN_PLACEHOLDER ? null : trimmed;
}

/** One SDN CSV line -> a record, or `null` for a blank/unparseable line
 * (an `ent_num` that isn't present at all — the file's last line is often
 * empty — or an unterminated quote that makes `parseCsvLine` refuse to
 * guess at field boundaries). */
export function parseOfacSdnLine(line: string): ParsedWatchlistRecord | null {
  if (!line.trim()) return null;
  const fields = parseCsvLine(line);
  if (!fields) return null;
  const entNum = ofacField(fields[0]);
  const name = ofacField(fields[1]);
  if (!entNum || !name) return null;
  const program = ofacField(fields[3]);
  const remarks = ofacField(fields[11]);
  return {
    sourceRecordId: entNum,
    fullName: name,
    listProgram: program,
    remarks,
  };
}

/** The full SDN CSV -> every parsable record. Pure — takes the raw text the
 * fetcher already downloaded. */
export function parseOfacSdnCsv(raw: string): ParsedWatchlistRecord[] {
  return raw
    .split(/\r?\n/)
    .map((line) => parseOfacSdnLine(line))
    .filter((r): r is ParsedWatchlistRecord => r !== null);
}

// ---------------------------------------------------------------------------
// UN Consolidated List XML — <CONSOLIDATED_LIST><INDIVIDUALS><INDIVIDUAL>...
// and <ENTITIES><ENTITY>...>, confirmed against the real, live document
// (2026-09-04). Every field this module reads (DATAID, FIRST_NAME,
// SECOND_NAME, THIRD_NAME, FOURTH_NAME, UN_LIST_TYPE, REFERENCE_NUMBER,
// COMMENTS1) is a flat, single-occurrence leaf tag directly inside
// <INDIVIDUAL>/<ENTITY> — none of them collide with a same-named tag nested
// inside a sibling structure (ENTITY_ALIAS/LIST_TYPE/LAST_DAY_UPDATED all use
// different tag names), so a first-match regex extraction per block is safe.
// Aliases are not matched — a documented scope limit, the primary-name-only
// shape `sample-watchlist.ts` already has.
// ---------------------------------------------------------------------------

function unescapeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractXmlTag(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(block);
  if (!match) return null;
  const text = unescapeXmlEntities(match[1]).trim();
  return text === '' ? null : text;
}

function extractXmlBlocks(raw: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function parseUnBlock(block: string): ParsedWatchlistRecord | null {
  const dataId = extractXmlTag(block, 'DATAID');
  if (!dataId) return null;
  const nameParts = [
    extractXmlTag(block, 'FIRST_NAME'),
    extractXmlTag(block, 'SECOND_NAME'),
    extractXmlTag(block, 'THIRD_NAME'),
    extractXmlTag(block, 'FOURTH_NAME'),
  ].filter((p): p is string => p !== null);
  const fullName = nameParts.join(' ').trim();
  if (!fullName) return null;
  const listType = extractXmlTag(block, 'UN_LIST_TYPE');
  const referenceNumber = extractXmlTag(block, 'REFERENCE_NUMBER');
  const listProgram =
    listType && referenceNumber
      ? `${listType} (${referenceNumber})`
      : (listType ?? referenceNumber);
  return {
    sourceRecordId: dataId,
    fullName,
    listProgram,
    remarks: extractXmlTag(block, 'COMMENTS1'),
  };
}

/** The full Consolidated List XML -> every INDIVIDUAL + ENTITY record.
 * Pure — takes the raw text the fetcher already downloaded. */
export function parseUnConsolidatedXml(raw: string): ParsedWatchlistRecord[] {
  const individuals = extractXmlBlocks(raw, 'INDIVIDUAL').map(parseUnBlock);
  const entities = extractXmlBlocks(raw, 'ENTITY').map(parseUnBlock);
  return [...individuals, ...entities].filter(
    (r): r is ParsedWatchlistRecord => r !== null,
  );
}

/** The source lists themselves refresh roughly every 12 hours — sync on
 * that cadence, not more often (there is nothing new to find) and not much
 * less (a name added mid-cycle should not sit unscreened for days). DRAFTED
 * in the sense that no OFAC/UN SLA document commits to exactly 12h, but it
 * is a real, observed publication cadence, not an arbitrary guess — see
 * `ibms-brain/meta/context/sanctions-pep-screening.md`. */
export const WATCHLIST_SYNC_CRON = '0 */12 * * *';

/** Re-screen every ACTIVE customer against the (now more current) lists
 * more often than the sync itself — a name could already be on a list this
 * broker has not re-synced yet, or a customer's KYC file could have been
 * approved between two syncs. 4 hours keeps the gap between "the list
 * changed" and "we checked again" to at most one sync interval plus one
 * screening interval — the backlog's own worked example (12h list refresh,
 * 4h check). Replaces the drafted monthly cadence #3-4 shipped with no
 * sourced figure at the time. */
export const SANCTIONS_RESCREEN_CRON = '0 */4 * * *';
