/*
 * The envelope the offset-paginated list endpoints return.
 *
 * Shared rather than declared per client, because the point of the shape is
 * that it is the same everywhere: one `Pagination` component reads it, and a
 * second, subtly different copy would be the thing that breaks that.
 *
 * Mirrors `apps/api/src/common/pagination.ts`. It does NOT describe
 * `/admin/users`, which predates this and returns `{ users, total }`.
 */
export interface Paginated<T> {
  items: T[];
  /** Rows matching the filter, not rows on this page — what the page control
   *  renders "of N" from, and how it knows when to stop. */
  total: number;
  page: number;
  pageSize: number;
}
