import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  LEGACY_IMPORT_MAX_BYTES,
  LEGACY_IMPORT_MAX_ROWS,
  mapRows,
  parseCsv,
} from './legacy-import.config';

describe('parseCsv', () => {
  it('refuses input longer than the byte cap instead of walking it', () => {
    // The loop inside parseCsv has to carry its own bound. The controller's
    // multer limit and the service's file.size check both sit upstream, and
    // mapRows' row cap only runs AFTER the whole string has been walked.
    const tooLong = 'a'.repeat(LEGACY_IMPORT_MAX_BYTES + 1);
    expect(() => parseCsv(tooLong)).toThrow(UnprocessableEntityException);
    expect(() => parseCsv(tooLong)).toThrow(/too large to read/);
  });

  it('accepts input exactly at the cap — the bound is not off by one', () => {
    // UTF-16 code units are <= UTF-8 bytes, so a file that passed the byte cap
    // can never be rejected here. This pins that the guard is >, not >=.
    const atLimit = 'a'.repeat(LEGACY_IMPORT_MAX_BYTES);
    expect(() => parseCsv(atLimit)).not.toThrow();
  });

  it('reads a plain file', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles quoted fields containing commas, quotes and newlines', () => {
    const csv = 'name,note\n"Ali, Ahmad","he said ""hi""\nsecond line"';
    expect(parseCsv(csv)).toEqual([
      ['name', 'note'],
      ['Ali, Ahmad', 'he said "hi"\nsecond line'],
    ]);
  });

  it('accepts CRLF without producing phantom empty rows', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM so the first heading is not corrupted', () => {
    // Excel's "Save as CSV" writes one. Without this the first column heading
    // is "\uFEFFlegalName", the mapping silently fails to find it, and the
    // office is told their column does not exist.
    const [header] = parseCsv('\uFEFFlegalName,type\nAcme,CORPORATE');
    expect(header[0]).toBe('legalName');
  });

  it('keeps Arabic text intact', () => {
    expect(parseCsv('name\nشركة الأمل')).toEqual([['name'], ['شركة الأمل']]);
  });
});

describe('mapRows', () => {
  const mapping = { legalName: 'Client Name', customerType: 'Type' };

  it('maps an office’s own headings onto the canonical fields', () => {
    const table = parseCsv(
      'Client Name,Type,Ignored\nAcme Ltd,CORPORATE,x\nAhmad Ali,individual,y',
    );
    const { rows, rejections } = mapRows(table, mapping);
    expect(rejections).toEqual([]);
    expect(rows.map((r) => [r.legalName, r.customerType])).toEqual([
      ['Acme Ltd', 'CORPORATE'],
      // Case-insensitive: an office's export will not match our enum casing.
      ['Ahmad Ali', 'INDIVIDUAL'],
    ]);
  });

  it('rejects bad rows by line number and imports the rest', () => {
    // The behaviour that matters operationally: 2 good rows out of 4 are still
    // worth loading, and the office needs the other 2 named — not a blanket
    // failure telling them to go and find the problem.
    const table = parseCsv(
      'Client Name,Type\nAcme,CORPORATE\n,CORPORATE\nBad Type,PARTNERSHIP\nAhmad,INDIVIDUAL',
    );
    const { rows, rejections } = mapRows(table, mapping);
    expect(rows.map((r) => r.legalName)).toEqual(['Acme', 'Ahmad']);
    expect(rejections).toEqual([
      { lineNumber: 3, reason: 'legalName is empty' },
      {
        lineNumber: 4,
        reason:
          'customerType must be INDIVIDUAL or CORPORATE, got "PARTNERSHIP"',
      },
    ]);
  });

  it('counts line numbers as the office sees them in their spreadsheet', () => {
    const table = parseCsv('Client Name,Type\nAcme,CORPORATE\n,CORPORATE');
    // Header is line 1, so the first data row is line 2 and the bad one is 3.
    expect(mapRows(table, mapping).rejections[0].lineNumber).toBe(3);
  });

  it('refuses a mapping that points at a column the file does not have', () => {
    const table = parseCsv('Name,Type\nAcme,CORPORATE');
    expect(() => mapRows(table, mapping)).toThrow(UnprocessableEntityException);
  });

  it('refuses a mapping that omits a required field', () => {
    const table = parseCsv('Client Name,Type\nAcme,CORPORATE');
    expect(() => mapRows(table, { legalName: 'Client Name' })).toThrow(
      UnprocessableEntityException,
    );
  });

  it('refuses an empty file and a header-only file', () => {
    expect(() => mapRows([], mapping)).toThrow(UnprocessableEntityException);
    expect(() => mapRows(parseCsv('Client Name,Type'), mapping)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('ignores blank lines rather than rejecting them', () => {
    // A trailing blank line is an artefact of every spreadsheet export; it is
    // not the office making a mistake and must not be reported as one.
    const table = parseCsv('Client Name,Type\nAcme,CORPORATE\n,\n');
    const { rows, rejections } = mapRows(table, mapping);
    expect(rows).toHaveLength(1);
    expect(rejections).toEqual([]);
  });

  it('refuses a file over the row cap', () => {
    const body = Array.from(
      { length: LEGACY_IMPORT_MAX_ROWS + 1 },
      (_, i) => `Client ${i},CORPORATE`,
    ).join('\n');
    expect(() =>
      mapRows(parseCsv(`Client Name,Type\n${body}`), mapping),
    ).toThrow(UnprocessableEntityException);
  });

  it('leaves an unmapped optional field undefined rather than empty-string', () => {
    const table = parseCsv('Client Name,Type,Country\nAcme,CORPORATE,');
    const { rows } = mapRows(table, { ...mapping, nationality: 'Country' });
    expect(rows[0].nationality).toBeUndefined();
  });
});
