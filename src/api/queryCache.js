/**
 * A very small stale-while-revalidate cache, sized for this app and nothing more.
 *
 * The problem it solves: every tab refetched its whole world on mount, so switching
 * back to a screen you were just on showed a 1–2s "Loading…" for data that hadn't
 * changed. Home and Progress each pull profile + sessions + sets + variants, so the
 * same six queries were being re-run constantly.
 *
 * The contract:
 *   - A screen with cached data renders it immediately and never shows a loading state.
 *   - Every mount still revalidates in the background, so nothing is ever served from
 *     cache without a fresh read behind it. This is what keeps it honest — the cache
 *     defers a render, it does not decide what the truth is.
 *   - Writes invalidate their own keys from inside db.js, so the refetch happens at the
 *     moment of the write rather than being left to whichever screen you visit next.
 *
 * Deliberately absent: time-based expiry, retries, pagination, garbage collection. If
 * this needs any of those it should be a real query library instead of this file.
 */

/** key -> { data, fetcher }. `fetcher` is remembered so invalidate() can re-run it. */
const entries = new Map()
/** key -> Promise, so N screens mounting at once share one request. */
const inflight = new Map()
/** key -> Set<fn>, notified whenever a key's data changes. */
const listeners = new Map()
/**
 * key -> monotonic request number. A forced refetch issued while an older request is
 * still in the air must win regardless of which response lands first, otherwise a slow
 * pre-write read can overwrite the post-write data it raced.
 */
const versions = new Map()

export function getCached(key) {
  return entries.get(key)
}

function emit(key, data) {
  const set = listeners.get(key)
  if (set) for (const fn of set) fn(data)
}

export function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(fn)
  return () => {
    const set = listeners.get(key)
    if (!set) return
    set.delete(fn)
    if (set.size === 0) listeners.delete(key)
  }
}

/**
 * Read a key, remembering its fetcher. Concurrent callers share one request unless
 * `force`, which always starts a new one.
 */
export function fetchQuery(key, fetcher, { force = false } = {}) {
  const existing = entries.get(key)
  const run = fetcher ?? existing?.fetcher
  if (!run) return Promise.resolve(undefined)
  if (fetcher && fetcher !== existing?.fetcher) {
    entries.set(key, { data: existing?.data, fetcher })
  }

  if (!force && inflight.has(key)) return inflight.get(key)

  const version = (versions.get(key) ?? 0) + 1
  versions.set(key, version)

  const request = Promise.resolve()
    .then(run)
    .then((data) => {
      // A superseded response is still returned to its own caller, but must not be
      // written to the cache or pushed to subscribers.
      if (versions.get(key) !== version) return data
      entries.set(key, { data, fetcher: run })
      emit(key, data)
      return data
    })
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key)
    })

  inflight.set(key, request)
  return request
}

/**
 * Mark keys as changed and refetch them now.
 *
 * The cached value is deliberately kept until the fresh one lands, so a screen already
 * showing it doesn't blink back to a loading state — it updates in place.
 */
export function invalidate(...keys) {
  for (const key of keys) {
    const entry = entries.get(key)
    if (!entry?.fetcher) {
      // Never read this session, so there is nothing to refresh and nothing showing it.
      entries.delete(key)
      continue
    }
    fetchQuery(key, entry.fetcher, { force: true }).catch(() => {
      // A failed background refresh must not become an unhandled rejection. The screen
      // keeps showing the last good data; its own next mount will surface any real error.
    })
  }
}

/** Drop everything. Called on sign-out so the next user never sees cached rows. */
export function clearCache() {
  entries.clear()
  inflight.clear()
  versions.clear()
}

/** Cache keys, centralised so a write and a read can't disagree about spelling. */
export const qk = {
  profile: 'profile',
  variants: 'variants',
  sessions: 'sessions',
  activeSession: 'sessions:active',
  sets: 'sets',
  readiness: 'readiness',
  templates: 'templates',
  muscleGoals: 'muscleGoals',
  excludedFlags: 'flags:excluded',
}
