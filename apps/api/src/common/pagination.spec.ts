import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  pageWindow,
  wholeSet,
} from './pagination';

describe('pageWindow', () => {
  it('defaults to the first page at the default size', () => {
    expect(pageWindow()).toEqual({
      take: DEFAULT_PAGE_SIZE,
      skip: 0,
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('offsets by whole pages', () => {
    expect(pageWindow(3)).toMatchObject({
      skip: 3 * DEFAULT_PAGE_SIZE,
      page: 3,
    });
  });

  it('caps the page size — this is the whole point of the module', () => {
    // Without the cap, ?pageSize=100000 is exactly the unbounded query that
    // made the list screens unusable at real volume.
    expect(pageWindow(0, 100_000)).toMatchObject({
      take: MAX_PAGE_SIZE,
      pageSize: MAX_PAGE_SIZE,
    });
  });

  it('absorbs nonsense rather than rejecting it', () => {
    // A negative page and a zero size are answerable requests; a 422 would
    // only move the clamping into the caller.
    expect(pageWindow(-5)).toMatchObject({ page: 0, skip: 0 });
    expect(pageWindow(0, 0)).toMatchObject({ pageSize: DEFAULT_PAGE_SIZE });
    expect(pageWindow(Number.NaN, Number.NaN)).toMatchObject({
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('floors a fractional page rather than producing a fractional skip', () => {
    expect(pageWindow(2.7)).toMatchObject({
      page: 2,
      skip: 2 * DEFAULT_PAGE_SIZE,
    });
  });
});

describe('wholeSet', () => {
  it('reports a bounded read as one complete page', () => {
    // `GET /policies?customerId=` is bounded by the customer it scopes to, so
    // it returns the same envelope as the paged branch rather than a bare
    // array - one response shape per endpoint means one client.
    expect(wholeSet(['a', 'b'])).toEqual({
      items: ['a', 'b'],
      total: 2,
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('never reports a page smaller than what it contains', () => {
    // The page control hides itself when `total <= pageSize`. A bounded read
    // longer than the default page must still hide it, or a scoped list would
    // grow a Next button that leads nowhere.
    const many = Array.from({ length: DEFAULT_PAGE_SIZE + 7 }, (_, i) => i);
    const page = wholeSet(many);
    expect(page.total).toBe(many.length);
    expect(page.pageSize).toBeGreaterThanOrEqual(page.total);
  });
});
