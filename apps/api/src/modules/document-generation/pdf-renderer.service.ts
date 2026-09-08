import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser } from 'playwright-core';

/**
 * Part F item #7 — system-generated bilingual documents. The rendering
 * mechanism was chosen empirically, not assumed: a real bilingual (Arabic +
 * English) HTML page was rendered through this exact library/browser
 * combination and visually inspected before this file was written —
 * contextual Arabic letter shaping, RTL table/paragraph direction, and
 * embedded LTR numbers inside RTL text all rendered correctly. A JS-native
 * PDF library (pdfkit/pdfmake) was considered and rejected: neither shapes
 * Arabic script itself, and there is no well-maintained library to do that
 * reshaping first — a real correctness risk for what is now this system's
 * PRIMARY language, not a secondary one.
 *
 * `playwright-core` (not `@playwright/test`) — the browser-automation
 * library alone, without the test runner this app's `apps/web` e2e suite
 * uses it for. This app's `apps/web` install already downloads a matching
 * Chromium revision (`e2e`/`test:a11y`); this service reuses that same
 * cached browser rather than triggering a second, independent download.
 *
 * One shared Chromium instance for the process lifetime (launching a fresh
 * browser per request would cost ~1-2s of cold-start on every single
 * document) — a fresh `page` per render, closed immediately after, so no
 * state leaks between concurrent renders of different documents.
 */
@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private browserPromise: Promise<Browser> | null = null;

  /** A launch failure (missing browser binary, resource exhaustion) or a
   * later crash must not wedge every future call behind the SAME stale
   * browser/error for the rest of the process's life — both paths reset
   * `browserPromise` to `null` (guarded by identity, `=== launched`, so a
   * late event from an OLD, already-replaced browser can't clobber a
   * fresh one) so the next call retries a genuine new launch. */
  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      // --no-sandbox: standard for headless Chromium running as a
      // container/CI process (no setuid sandbox helper available there);
      // harmless for local dev too.
      const launched = chromium.launch({ args: ['--no-sandbox'] });
      this.browserPromise = launched;
      launched
        .then((browser) => {
          browser.once('disconnected', () => {
            if (this.browserPromise === launched) this.browserPromise = null;
          });
        })
        .catch(() => {
          if (this.browserPromise === launched) this.browserPromise = null;
        });
    }
    return this.browserPromise;
  }

  /** Renders a self-contained HTML string (inline `<style>`, no external
   * network requests expected — `waitUntil: 'load'` is enough since
   * nothing here fetches a remote resource today) to a PDF buffer.
   *
   * Every non-`data:` request is aborted regardless — defense in depth,
   * not defense against today's templates (verified none of them
   * reference anything external). This is the SHARED rendering path for
   * 5 more document types item #7 hasn't built yet; a future template
   * adding an `<img src="https://...">` would otherwise turn a headless
   * browser reachable from wherever the api process runs into a real SSRF
   * primitive. */
  async renderHtmlToPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.route('**/*', (route) => {
        if (route.request().url().startsWith('data:')) {
          return route.continue();
        }
        return route.abort();
      });
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ format: 'A4', printBackground: true });
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    try {
      const browser = await this.browserPromise;
      await browser.close();
    } catch (err) {
      this.logger.warn(
        `Failed to close the shared PDF-rendering browser cleanly on shutdown: ${(err as Error).message}`,
      );
    }
  }
}
