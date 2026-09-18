import { describe, it, expect, beforeEach } from 'vitest';
import { getCached, fetchQuery, subscribe, invalidate, clearCache, qk } from './queryCache.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  clearCache();
});

describe('reading', () => {
  it('has nothing for a key never fetched', () => {
    expect(getCached('nobody')).toBeUndefined();
  });

  it('remembers the value and the fetcher that produced it', async () => {
    const f = () => Promise.resolve('value');
    await fetchQuery('k', f);
    expect(getCached('k').data).toBe('value');
    expect(getCached('k').fetcher).toBe(f);
  });

  it('resolves undefined rather than throwing when no fetcher was ever supplied', async () => {
    await expect(fetchQuery('k')).resolves.toBeUndefined();
  });

  it('reuses the remembered fetcher when called again without one', async () => {
    let calls = 0;
    await fetchQuery('k', () => {
      calls += 1;
      return Promise.resolve(calls);
    });
    await fetchQuery('k', undefined, { force: true });
    expect(calls).toBe(2);
  });
});

describe('sharing one request', () => {
  it('gives concurrent callers the same promise and runs the fetcher once', async () => {
    let calls = 0;
    const d = deferred();
    const f = () => {
      calls += 1;
      return d.promise;
    };

    const first = fetchQuery('k', f);
    const second = fetchQuery('k', f);
    expect(first).toBe(second);

    d.resolve('once');
    await first;
    expect(calls).toBe(1);
  });

  it('force starts a new request instead of joining the one in flight', async () => {
    const a = deferred();
    const b = deferred();

    const first = fetchQuery('k', () => a.promise);
    const second = fetchQuery('k', () => b.promise, { force: true });
    expect(first).not.toBe(second);

    a.resolve('a');
    b.resolve('b');
    await Promise.all([first, second]);
  });

  it('accepts a new request once the previous one has settled', async () => {
    await fetchQuery('k', () => Promise.resolve(1));
    await fetchQuery('k', () => Promise.resolve(2));
    expect(getCached('k').data).toBe(2);
  });
});

describe('a superseded read must not overwrite newer data', () => {
  it('keeps the newer value when a slower older request lands last', async () => {
    const slow = deferred();
    const fast = deferred();

    const stale = fetchQuery('k', () => slow.promise);
    const fresh = fetchQuery('k', () => fast.promise, { force: true });

    fast.resolve('post-write');
    await fresh;
    expect(getCached('k').data).toBe('post-write');

    slow.resolve('pre-write');
    await stale;
    expect(getCached('k').data).toBe('post-write');
  });

  it('still returns the superseded value to the caller that asked for it', async () => {
    const slow = deferred();
    const fast = deferred();

    const stale = fetchQuery('k', () => slow.promise);
    const fresh = fetchQuery('k', () => fast.promise, { force: true });

    fast.resolve('post-write');
    await fresh;
    slow.resolve('pre-write');

    await expect(stale).resolves.toBe('pre-write');
  });

  it('does not push a superseded value to subscribers', async () => {
    const seen = [];
    const off = subscribe('k', (v) => seen.push(v));

    const slow = deferred();
    const fast = deferred();
    const stale = fetchQuery('k', () => slow.promise);
    const fresh = fetchQuery('k', () => fast.promise, { force: true });

    fast.resolve('post-write');
    await fresh;
    slow.resolve('pre-write');
    await stale;

    expect(seen).toEqual(['post-write']);
    off();
  });
});

describe('subscribers', () => {
  it('hears each value as it lands', async () => {
    const seen = [];
    const off = subscribe('k', (v) => seen.push(v));
    await fetchQuery('k', () => Promise.resolve(1));
    await fetchQuery('k', () => Promise.resolve(2));
    expect(seen).toEqual([1, 2]);
    off();
  });

  it('hears nothing after unsubscribing', async () => {
    const seen = [];
    const off = subscribe('k', (v) => seen.push(v));
    await fetchQuery('k', () => Promise.resolve(1));
    off();
    await fetchQuery('k', () => Promise.resolve(2));
    expect(seen).toEqual([1]);
  });

  it('keeps one listener alive when another unsubscribes', async () => {
    const a = [];
    const b = [];
    const offA = subscribe('k', (v) => a.push(v));
    const offB = subscribe('k', (v) => b.push(v));
    offA();
    await fetchQuery('k', () => Promise.resolve(1));
    expect(a).toEqual([]);
    expect(b).toEqual([1]);
    offB();
  });

  it('does not leak across keys', async () => {
    const seen = [];
    const off = subscribe('other', (v) => seen.push(v));
    await fetchQuery('k', () => Promise.resolve(1));
    expect(seen).toEqual([]);
    off();
  });
});

describe('invalidate', () => {
  it('drops a key never read this session rather than fetching it', () => {
    invalidate('never-read');
    expect(getCached('never-read')).toBeUndefined();
  });

  it('keeps showing the last good value while the refresh is in flight', async () => {
    let gate = deferred();
    gate.resolve('first');
    const f = () => gate.promise;

    await fetchQuery('k', f);
    gate = deferred();
    invalidate('k');

    expect(getCached('k').data).toBe('first');

    gate.resolve('second');
    await flush();
    expect(getCached('k').data).toBe('second');
  });

  it('keeps the last good value when the background refresh fails', async () => {
    let fail = false;
    const f = () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve('good'));

    await fetchQuery('k', f);
    fail = true;
    invalidate('k');
    await flush();

    expect(getCached('k').data).toBe('good');
  });

  it('refreshes several keys at once', async () => {
    let n = 0;
    const f = () => Promise.resolve((n += 1));
    await fetchQuery('a', f);
    await fetchQuery('b', f);
    invalidate('a', 'b');
    await flush();
    expect(getCached('a').data).not.toBe(1);
    expect(getCached('b').data).not.toBe(2);
  });
});

describe('clearCache', () => {
  it('leaves nothing for the next account to read', async () => {
    await fetchQuery('k', () => Promise.resolve('mine'));
    clearCache();
    expect(getCached('k')).toBeUndefined();
  });
});

describe('qk', () => {
  it('spells every key exactly once, so a read and a write cannot disagree', () => {
    const values = Object.values(qk);
    expect(new Set(values).size).toBe(values.length);
  });
});
