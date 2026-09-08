/** Part F item #7 — shared across every document type's HTML template.
 * Promoted here when the SECOND document type (quotation comparison)
 * landed — `complaint-acknowledgement.template.ts` (the first) used to
 * carry its own private copies of all of this; a `@code-reviewer` MINOR
 * finding on that first pass flagged exactly this as worth doing before a
 * second template forked its own slightly-different copy. */

export type DocumentLanguage = 'AR' | 'EN' | 'DUAL';

/** Load-bearing, not defensive-by-habit: every document type merges real
 * customer-supplied free text (a complaint's issue, a quotation's
 * exclusions/conditions, ...) into HTML rendered inside a REAL headless
 * browser (`PdfRendererService`) — the first time this codebase renders
 * user-influenced content inside an actual browser engine. An unescaped
 * `<script>`/`<iframe>` would not just be a cosmetic HTML-injection bug,
 * it would EXECUTE inside that page context. Every interpolated value in
 * every document template must go through this first. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `'ar'` (bare, not `'ar-JO'`) + `'en-GB'` — the SAME locale-tag pair
 * `apps/web/lib/i18n/format.ts` uses (Part F item #5), empirically
 * verified there against Node's own ICU: a region-qualified Arabic tag
 * silently switches to Eastern Arabic-Indic numerals, an unwanted
 * surprise nothing in this app has ever asked for. This is the api-side
 * equivalent for server-rendered documents — `formatMoney`/`formatDate`
 * themselves live in `apps/web` and are not importable from `apps/api`
 * (no shared utility package spans the two apps' runtime code, only
 * `packages/db`), so this is a deliberate, minimal re-implementation. */
export function formatDocumentDate(d: Date, lang: 'en' | 'ar'): string {
  const locale = lang === 'ar' ? 'ar' : 'en-GB';
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Mirrors `apps/web/lib/i18n/format.ts#formatMoney()`'s exact contract
 * (null → em dash, a non-finite value passed through raw with the
 * currency prefix, `'ar'`/`'en-GB'` locale tags) — the api-side
 * equivalent for server-rendered documents. Accepts anything
 * `Decimal`-shaped (a real `Prisma.Decimal` instance server-side never
 * round-trips through JSON here, unlike the web client) via a minimal
 * structural type rather than importing `@ibms/db`'s `Prisma` namespace
 * into this shared, document-type-agnostic file.
 *
 * Every real caller so far (`Quotation.premium`/`deductible`/
 * `liabilityLimit`) is regex-validated (`MONEY_STRING`,
 * `apps/api/src/common/dto.util.ts`) before ever becoming a
 * `Prisma.Decimal`, so `.toString()` can only ever produce digits/a
 * decimal point today — the non-finite branch below is currently
 * unreachable with HTML-shaped content. Escaped anyway: this is now
 * SHARED infrastructure, and `money-decimal-jod.md` itself flags
 * insurer-statement/webhook/upload-sourced amounts as a future case that
 * may arrive as strings with no such upstream guarantee. */
export function formatDocumentMoney(
  value: { toString(): string } | null,
  lang: 'en' | 'ar',
  currency = 'JOD',
): string {
  if (value === null) return '—';
  const raw = value.toString();
  const n = Number(raw);
  const locale = lang === 'ar' ? 'ar' : 'en-GB';
  return Number.isFinite(n)
    ? `${currency} ${n.toLocaleString(locale, {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      })}`
    : `${escapeHtml(currency)} ${escapeHtml(raw)}`;
}

/** Promoted out of `quotation-comparison.template.ts` (the second
 * document type) once the THIRD (recommendation report) needed the exact
 * same "N months" bilingual rendering — the same "promote before a third
 * template forks its own copy" discipline this file's own header already
 * established for the first→second promotion. */
export function formatDocumentBiPeriod(
  months: number | null,
  lang: 'en' | 'ar',
): string {
  if (months === null) return '—';
  return lang === 'ar' ? `${months} شهر` : `${months} mo`;
}

/** Promoted alongside `formatDocumentBiPeriod` above, for the same
 * reason. Escapes ONCE, internally — a caller must place its result
 * directly into HTML, never re-escape it (re-escaping a percent sign or
 * digit is harmless, but re-escaping this function's own `&lt;`-shaped
 * output from a pathological value would double-encode it). */
export function formatDocumentPercent(
  value: { toString(): string } | null,
  lang: 'en' | 'ar',
): string {
  if (value === null) return '—';
  const pct = escapeHtml(value.toString());
  return lang === 'ar' ? `%${pct}` : `${pct}%`;
}

/** Base rules every document shares (fonts, table borders, page-break
 * marker). A template may append its own additional rules after this. */
export const DOCUMENT_BASE_CSS = `
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 40px; color: #1a1a1a; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #555; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  td, th { border: 1px solid #999; padding: 8px; text-align: start; font-size: 14px; }
  p { line-height: 1.6; font-size: 14px; }
  .page-break { page-break-before: always; }
`;
