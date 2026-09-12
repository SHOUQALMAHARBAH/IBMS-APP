/**
 * A bounded, timed HTTP GET for large third-party downloads.
 *
 * ## Why this exists separately from the provider base classes
 *
 * `BaseScreeningProvider` and `BaseEmailProvider` each carry their own
 * `fetchWithRetry`, because each weaves in behaviour this one deliberately does
 * not have: a circuit breaker in the first, a `CredentialRejectedError` for
 * 401/403 in the second. Both are per-request integrations with credentials.
 *
 * This one is for the opposite shape — an unauthenticated, infrequent download
 * of a large public file. It is what the watchlist fetchers use, and it exists
 * because they previously used a bare `fetch(url)` with **no timeout at all**:
 * a stalled connection to a public sanctions endpoint would hang the nightly
 * sync indefinitely rather than fail it.
 *
 * ## The detail that matters for a large body
 *
 * The timeout covers the **body read**, not just the response headers. A
 * multi-megabyte CSV can stall halfway through streaming, and clearing the
 * abort timer as soon as headers arrive would leave that stall unbounded — the
 * exact hang this replaces. The signal stays live until the full text is in
 * hand.
 */

export interface HttpDownloadOptions {
  /** Whole-request budget, covering connection, headers AND body. */
  timeoutMs: number;
  /** Additional attempts after the first. */
  maxRetries: number;
}

/** Public sanctions lists are single-digit megabytes; anything wildly past that
 * is a redirect to an error page or a hijacked endpoint, not a list. */
const MAX_BYTES = 64 * 1024 * 1024;

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * GETs `url` and returns the body as text, with a whole-request timeout and
 * bounded retry.
 *
 * Retries a timeout, a transport error, a 5xx or a 429. A 4xx is a request
 * problem that will fail identically every time — retrying only delays the
 * report and hammers a public endpoint.
 */
export async function fetchTextWithRetry(
  url: string,
  options: HttpDownloadOptions,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        const error = new Error(`GET ${url} -> HTTP ${response.status}`);
        if (!isRetryableStatus(response.status)) throw error;
        lastError = error;
        continue;
      }

      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        // Not retryable: the endpoint is serving something this is not.
        throw new Error(
          `GET ${url} -> ${declared} bytes, past the ${MAX_BYTES}-byte ceiling`,
        );
      }

      // Still inside the timeout window on purpose — see the file header.
      return await response.text();
    } catch (err) {
      const error = err as Error;
      lastError =
        error.name === 'AbortError'
          ? new Error(`GET ${url} -> timed out after ${options.timeoutMs}ms`)
          : error;
      // A non-retryable status was thrown above; stop rather than burn retries.
      if (/-> HTTP [4]\d\d$/.test(lastError.message)) break;
      if (/past the \d+-byte ceiling$/.test(lastError.message)) break;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < options.maxRetries) {
      // Jittered backoff. These are shared public endpoints; a fleet retrying
      // in lockstep is a self-inflicted denial of service on a service nobody
      // here operates.
      const backoff = 2 ** attempt * 1000 + Math.floor(Math.random() * 500);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError ?? new Error(`GET ${url} failed`);
}
