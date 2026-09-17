import { Transform } from 'class-transformer';
import { IsObject } from 'class-validator';
import { UnprocessableEntityException } from '@nestjs/common';
import { LEGACY_IMPORT_FIELDS } from '../legacy-import.config';

/**
 * Part III §7.1 — the per-office column mapping, sent alongside the file.
 *
 * A multipart field is a string, so this arrives as JSON text and is parsed
 * here rather than in the service: a malformed mapping is a bad request, and
 * it should be refused before a single row is read.
 */
export class LegacyImportDto {
  @Transform(({ value }: { value: unknown }) => {
    // Not a string: leave it for @IsObject to reject rather than guessing.
    if (typeof value !== 'string') return value;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new UnprocessableEntityException(
        'mapping must be a JSON object of { field: "your column heading" }.',
      );
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new UnprocessableEntityException(
        'mapping must be a JSON OBJECT of { field: "your column heading" }.',
      );
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    for (const [field, heading] of entries) {
      // An unknown key is refused rather than ignored. Silently dropping a
      // misspelled field name would import the file with that column missing
      // and report success — the office would find out when someone looked.
      if (!(LEGACY_IMPORT_FIELDS as readonly string[]).includes(field)) {
        throw new UnprocessableEntityException(
          `mapping names an unknown field "${field}". Supported: ${LEGACY_IMPORT_FIELDS.join(', ')}.`,
        );
      }
      if (typeof heading !== 'string' || heading.trim() === '') {
        throw new UnprocessableEntityException(
          `mapping for "${field}" must be a non-empty column heading.`,
        );
      }
    }
    return Object.fromEntries(entries) as Record<string, string>;
  })
  @IsObject()
  mapping!: Record<string, string>;
}
