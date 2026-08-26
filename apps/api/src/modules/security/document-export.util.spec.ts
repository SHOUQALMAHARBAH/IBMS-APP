import { describe, expect, it } from 'vitest';
import {
  assertExportAllowed,
  buildWatermarkText,
  requiresWatermark,
} from './document-export.util';
import type { DataClassification } from '@ibms/db';

describe('requiresWatermark', () => {
  it('requires a watermark only for HIGHLY_CONFIDENTIAL', () => {
    expect(requiresWatermark('HIGHLY_CONFIDENTIAL')).toBe(true);
    expect(requiresWatermark('CONFIDENTIAL')).toBe(false);
    expect(requiresWatermark('INTERNAL')).toBe(false);
    expect(requiresWatermark('PUBLIC')).toBe(false);
  });
});

describe('buildWatermarkText', () => {
  it('embeds classification, user, and timestamp — never document content', () => {
    const text = buildWatermarkText({
      classification: 'HIGHLY_CONFIDENTIAL',
      userId: 'user-123',
      exportedAt: new Date('2026-08-26T12:00:00.000Z'),
    });
    expect(text).toBe(
      'HIGHLY_CONFIDENTIAL — exported by user-123 at 2026-08-26T12:00:00.000Z',
    );
  });

  it('defaults exportedAt to now when omitted', () => {
    const text = buildWatermarkText({
      classification: 'CONFIDENTIAL',
      userId: 'user-123',
    });
    expect(text).toMatch(
      /^CONFIDENTIAL — exported by user-123 at \d{4}-\d{2}-\d{2}T/,
    );
  });
});

describe('assertExportAllowed', () => {
  it('blocks a HIGHLY_CONFIDENTIAL export with no watermark applied', () => {
    expect(() =>
      assertExportAllowed({
        classification: 'HIGHLY_CONFIDENTIAL',
        watermarkApplied: false,
      }),
    ).toThrow(/cannot be exported, printed, or downloaded without a watermark/);
  });

  it('allows a HIGHLY_CONFIDENTIAL export once watermarked', () => {
    expect(() =>
      assertExportAllowed({
        classification: 'HIGHLY_CONFIDENTIAL',
        watermarkApplied: true,
      }),
    ).not.toThrow();
  });

  it.each(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'] as DataClassification[])(
    'never blocks a %s export regardless of watermark state',
    (classification) => {
      expect(() =>
        assertExportAllowed({ classification, watermarkApplied: false }),
      ).not.toThrow();
    },
  );
});
