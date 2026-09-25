import { describe, it, expect } from 'vitest';
import { newestFirst } from './paginate.js';

// A stand-in for the table: rows 1..n by time, served newest-first with a per-request cap
// like Supabase's "Max rows".
function fakeTable(n, { cap = 1000, withCount = true } = {}) {
  const newest = Array.from({ length: n }, (_, i) => ({ id: n - i, t: n - i }));
  const calls = [];
  const fetchPage = async (from, to, count) => {
    calls.push([from, to, count]);
    const end = Math.min(to + 1, from + cap);
    return { data: newest.slice(from, end), count: count && withCount ? n : null };
  };
  return { fetchPage, calls };
}

const ids = (rows) => rows.map((r) => r.id);

describe('newestFirst', () => {
  it('keeps the NEWEST rows when history outgrows the limit, oldest-first', async () => {
    const { fetchPage } = fakeTable(10);
    expect(ids(await newestFirst(fetchPage, 4))).toEqual([7, 8, 9, 10]);
  });

  it('returns everything, in time order, when history fits', async () => {
    const { fetchPage } = fakeTable(3);
    expect(ids(await newestFirst(fetchPage, 5000))).toEqual([1, 2, 3]);
  });

  it('pages past a server cap instead of stopping at it', async () => {
    // The real bug: a 1000-row response cap under a 5000 limit.
    const { fetchPage, calls } = fakeTable(2500, { cap: 1000 });
    const rows = await newestFirst(fetchPage, 5000);
    expect(rows).toHaveLength(2500);
    expect(rows[0].id).toBe(1);
    expect(rows.at(-1).id).toBe(2500);
    expect(calls).toHaveLength(3);
  });

  it('pages correctly when the server cap is below the page size', async () => {
    const { fetchPage } = fakeTable(25, { cap: 7 });
    expect(ids(await newestFirst(fetchPage, 5000, 10))).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1)
    );
  });

  it('makes one request when the first page holds everything', async () => {
    const { fetchPage, calls } = fakeTable(40);
    await newestFirst(fetchPage, 5000);
    expect(calls).toEqual([[0, 999, true]]);
  });

  it('still terminates when the count is unavailable', async () => {
    const { fetchPage, calls } = fakeTable(5, { withCount: false });
    expect(ids(await newestFirst(fetchPage, 5000))).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toHaveLength(2); // the second, empty page is the stop signal
  });

  it('drops a row repeated across pages by an insert between reads', async () => {
    const pages = [
      { data: [{ id: 'c' }, { id: 'b' }], count: 3 },
      { data: [{ id: 'b' }, { id: 'a' }], count: null },
    ];
    let i = 0;
    const rows = await newestFirst(async () => pages[i++] ?? { data: [] }, 5000, 2);
    expect(ids(rows)).toEqual(['a', 'b', 'c']);
  });

  it('propagates a failed page rather than returning a partial history', async () => {
    const fetchPage = async () => {
      throw new Error('boom');
    };
    await expect(newestFirst(fetchPage, 10)).rejects.toThrow('boom');
  });
});
