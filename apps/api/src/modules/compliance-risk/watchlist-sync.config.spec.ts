import { describe, expect, it } from 'vitest';
import {
  WATCHLIST_MIN_ABSOLUTE_RECORDS,
  WATCHLIST_MIN_ACCEPTABLE_RATIO,
  normalizeWatchlistName,
  parseCsvLine,
  parseOfacSdnCsv,
  parseOfacSdnLine,
  parseUnConsolidatedXml,
} from './watchlist-sync.config';

describe('normalizeWatchlistName (Process 49)', () => {
  it('uppercases, strips punctuation, and sorts tokens', () => {
    expect(normalizeWatchlistName('Al Zawahiri, Dr. Ayman')).toBe(
      normalizeWatchlistName('Ayman Al-Zawahiri Dr'),
    );
  });

  it('is order-independent — the same tokens in any order normalize identically', () => {
    expect(normalizeWatchlistName('Eric Badege')).toBe(
      normalizeWatchlistName('Badege Eric'),
    );
  });

  it('collapses repeated whitespace', () => {
    expect(normalizeWatchlistName('Eric   Badege')).toBe(
      normalizeWatchlistName('Eric Badege'),
    );
  });

  it('two genuinely different names normalize differently', () => {
    expect(normalizeWatchlistName('Eric Badege')).not.toBe(
      normalizeWatchlistName('Perfectly Ordinary Trading Co'),
    );
  });

  // A @code-reviewer BLOCKER on the first pass: an ASCII-only [A-Z0-9]
  // character class reduced an all-Arabic-script name to "" — a universal
  // false-positive wildcard against every other empty-string name. The
  // Unicode-aware \p{L}/\p{N} class must keep Arabic letters as real,
  // distinguishing characters.
  it('keeps non-Latin (Arabic) letters as real tokens, not stripped to empty', () => {
    const normalized = normalizeWatchlistName('أحمد الزهراني');
    expect(normalized).not.toBe('');
    expect(normalized).toBe(normalizeWatchlistName('الزهراني أحمد'));
  });

  it('a name of pure punctuation/whitespace still normalizes to "" (documented residual risk)', () => {
    expect(normalizeWatchlistName('...---...')).toBe('');
  });
});

describe('watchlist sync plausibility constants (Process 49)', () => {
  it('the ratio floor is a fraction between 0 and 1', () => {
    expect(WATCHLIST_MIN_ACCEPTABLE_RATIO).toBeGreaterThan(0);
    expect(WATCHLIST_MIN_ACCEPTABLE_RATIO).toBeLessThan(1);
  });

  it('the absolute floor is a small positive sanity threshold', () => {
    expect(WATCHLIST_MIN_ABSOLUTE_RECORDS).toBeGreaterThan(0);
  });
});

describe('parseCsvLine (Process 49)', () => {
  it('splits unquoted comma-separated fields', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quoted fields intact', () => {
    expect(parseCsvLine('1,"AL ZAWAHIRI, Dr. Ayman","individual"')).toEqual([
      '1',
      'AL ZAWAHIRI, Dr. Ayman',
      'individual',
    ]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(parseCsvLine('1,"the ""alias"" name"')).toEqual([
      '1',
      'the "alias" name',
    ]);
  });

  it('trims unquoted fields but not quoted ones', () => {
    expect(parseCsvLine('1,-0- ,"kept  as-is"')).toEqual([
      '1',
      '-0-',
      'kept  as-is',
    ]);
  });

  // A @code-reviewer MINOR on the first pass: an unterminated quote left
  // the naive state machine merging every subsequent field into one
  // garbled value instead of being rejected as unparseable.
  it('returns null for a line with an unterminated quote', () => {
    expect(parseCsvLine('1,"AL ZAWAHIRI, Dr. Ayman","individual')).toBeNull();
    expect(parseCsvLine('1,"unterminated')).toBeNull();
  });
});

describe('parseOfacSdnLine / parseOfacSdnCsv (Process 49)', () => {
  // Real lines from the live SDN CSV (captured 2026-09-04), trimmed to the
  // cases this module cares about.
  const VESSEL_LINE =
    '36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ';
  const INDIVIDUAL_LINE =
    '2674,"ABBAS, Abu","individual","SDGT","Director of PALESTINE LIBERATION FRONT - ABU ABBAS FACTION",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 10 Dec 1948; Secondary sanctions risk: section 1(b) of Executive Order 13224, as amended by Executive Order 13886; Director of PALESTINE LIBERATION FRONT - ABU ABBAS FACTION."';

  it('parses ent_num, SDN_Name, Program, and Remarks; -0- placeholders become null', () => {
    const record = parseOfacSdnLine(INDIVIDUAL_LINE);
    expect(record).toEqual({
      sourceRecordId: '2674',
      fullName: 'ABBAS, Abu',
      listProgram: 'SDGT',
      remarks:
        'DOB 10 Dec 1948; Secondary sanctions risk: section 1(b) of Executive Order 13224, as amended by Executive Order 13886; Director of PALESTINE LIBERATION FRONT - ABU ABBAS FACTION.',
    });
  });

  it('a row with every filler field still parses the name + program', () => {
    const record = parseOfacSdnLine(VESSEL_LINE);
    expect(record).toEqual({
      sourceRecordId: '36',
      fullName: 'AEROCARIBBEAN AIRLINES',
      listProgram: 'CUBA',
      remarks: null,
    });
  });

  it('a blank line parses to null', () => {
    expect(parseOfacSdnLine('')).toBeNull();
    expect(parseOfacSdnLine('   ')).toBeNull();
  });

  it('a line with an unterminated quote parses to null rather than a garbled record', () => {
    expect(parseOfacSdnLine('36,"AEROCARIBBEAN AIRLINES,-0- ,CUBA')).toBeNull();
  });

  it('parseOfacSdnCsv parses every non-blank line and skips blank ones', () => {
    const raw = `${VESSEL_LINE}\n${INDIVIDUAL_LINE}\n\n`;
    const records = parseOfacSdnCsv(raw);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.sourceRecordId)).toEqual(['36', '2674']);
  });
});

describe('parseUnConsolidatedXml (Process 49)', () => {
  // A trimmed real INDIVIDUAL + ENTITY block from the live Consolidated
  // List (captured 2026-09-04).
  const RAW_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<CONSOLIDATED_LIST dateGenerated="2026-09-03T23:00:00.818Z">
  <INDIVIDUALS>
    <INDIVIDUAL>
      <DATAID>6907993</DATAID>
      <VERSIONNUM>1</VERSIONNUM>
      <FIRST_NAME>ERIC</FIRST_NAME>
      <SECOND_NAME>BADEGE</SECOND_NAME>
      <UN_LIST_TYPE>DRC</UN_LIST_TYPE>
      <REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER>
      <LISTED_ON>2012-12-31</LISTED_ON>
      <GENDER>Male</GENDER>
      <COMMENTS1>He fled to Rwanda in March 2013 &amp; is still living there.</COMMENTS1>
    </INDIVIDUAL>
    <INDIVIDUAL>
      <DATAID>6907995</DATAID>
      <FIRST_NAME>MUHINDO</FIRST_NAME>
      <SECOND_NAME>AKILI</SECOND_NAME>
      <THIRD_NAME>MUNDOS</THIRD_NAME>
      <UN_LIST_TYPE>DRC</UN_LIST_TYPE>
      <REFERENCE_NUMBER>CDi.032</REFERENCE_NUMBER>
    </INDIVIDUAL>
  </INDIVIDUALS>
  <ENTITIES>
    <ENTITY>
      <DATAID>6908402</DATAID>
      <FIRST_NAME>ADF</FIRST_NAME>
      <UN_LIST_TYPE>DRC</UN_LIST_TYPE>
      <REFERENCE_NUMBER>CDe.001</REFERENCE_NUMBER>
      <COMMENTS1>ADF founder and leader was arrested.</COMMENTS1>
    </ENTITY>
  </ENTITIES>
</CONSOLIDATED_LIST>`;

  it('parses an INDIVIDUAL with FIRST_NAME + SECOND_NAME, UN_LIST_TYPE, REFERENCE_NUMBER, and COMMENTS1 (XML-unescaped)', () => {
    const records = parseUnConsolidatedXml(RAW_XML);
    const eric = records.find((r) => r.sourceRecordId === '6907993')!;
    expect(eric.fullName).toBe('ERIC BADEGE');
    expect(eric.listProgram).toBe('DRC (CDi.001)');
    expect(eric.remarks).toBe(
      'He fled to Rwanda in March 2013 & is still living there.',
    );
  });

  it('assembles FIRST_NAME + SECOND_NAME + THIRD_NAME in document order', () => {
    const records = parseUnConsolidatedXml(RAW_XML);
    const muhindo = records.find((r) => r.sourceRecordId === '6907995')!;
    expect(muhindo.fullName).toBe('MUHINDO AKILI MUNDOS');
    expect(muhindo.remarks).toBeNull();
  });

  it('parses an ENTITY the same way, using FIRST_NAME as the entity name', () => {
    const records = parseUnConsolidatedXml(RAW_XML);
    const adf = records.find((r) => r.sourceRecordId === '6908402')!;
    expect(adf.fullName).toBe('ADF');
    expect(adf.listProgram).toBe('DRC (CDe.001)');
  });

  it('returns every INDIVIDUAL and ENTITY, individuals first', () => {
    const records = parseUnConsolidatedXml(RAW_XML);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.sourceRecordId)).toEqual([
      '6907993',
      '6907995',
      '6908402',
    ]);
  });

  it('a block with no DATAID is skipped', () => {
    const records = parseUnConsolidatedXml(
      '<INDIVIDUAL><FIRST_NAME>NO ID</FIRST_NAME></INDIVIDUAL>',
    );
    expect(records).toHaveLength(0);
  });
});
