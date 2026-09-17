/**
 * Offset pagination for the list endpoints that actually grow.
 *
 * Offset, not cursor, and deliberately: these screens are browsed by a person
 * who wants "page 3", not scrolled by a client consuming a stream, and the
 * repository queries already order by `createdAt desc`. A cursor would be the
 * right answer for an export or an infinite scroll; neither exists here.
 *
 * Applied to the five lists a real office grows without bound — customers,
 * policies, claims, invoices and the audit trail. NOT applied to every
 * `findMany` in the codebase: most read a bounded set (one policy's schedules,
 * one claim's documents) where a page control would be noise.
 *
 * The shape is uniform across all five so the frontend has one control to
 * write. It differs from `/admin/users`, which predates this and returns
 * `{ users, total }` — that one is left alone rather than broken for symmetry.
 */

/** One page. Chosen to fill a table without scrolling on a laptop, and small
 *  enough that the query stays cheap on a back-book of any size. */
export const DEFAULT_PAGE_SIZE = 50;

/** The ceiling a caller can ask for. Without it, `?pageSize=100000` is the
 *  unbounded query this module exists to remove. */
export const MAX_PAGE_SIZE = 200;

export interface Paginated<T> {
  items: T[];
  /** Rows matching the filter, not rows on this page — what a page control
   *  needs in order to render "of N" and to know when to stop. */
  total: number;
  page: number;
  pageSize: number;
}

/** Clamps whatever arrived on the query string into a usable window. A
 *  negative page, a zero size and a five-figure size are all callers this
 *  should absorb rather than reject: the request is answerable, and a 422
 *  would only push the same clamping into the client. */
export function pageWindow(
  page?: number,
  pageSize?: number,
): { take: number; skip: number; page: number; pageSize: number } {
  const safePage =
    Number.isFinite(page) && (page as number) > 0
      ? Math.floor(page as number)
      : 0;
  const requested =
    Number.isFinite(pageSize) && (pageSize as number) > 0
      ? Math.floor(pageSize as number)
      : DEFAULT_PAGE_SIZE;
  const safeSize = Math.min(requested, MAX_PAGE_SIZE);
  return {
    take: safeSize,
    skip: safePage * safeSize,
    page: safePage,
    pageSize: safeSize,
  };
}

/** Wraps a read that is bounded by construction — one opportunity's policy, one
 *  customer's policies — in the same envelope a paged read returns. The client
 *  then has one response shape per endpoint instead of one per branch, and the
 *  page control hides itself because `total <= pageSize`. */
export function wholeSet<T>(items: T[]): Paginated<T> {
  return {
    items,
    total: items.length,
    page: 0,
    pageSize: Math.max(items.length, DEFAULT_PAGE_SIZE),
  };
}
