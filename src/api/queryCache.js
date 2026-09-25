// A very small stale-while-revalidate cache. A screen with cached data renders immediately
// and never shows a spinner, but every mount still revalidates behind it — the cache defers
// a render, it does not decide what the truth is. Writes invalidate their own keys inside
// db.js. No expiry, retries, pagination or GC: needing those means using a real query
// library instead of this file.

/** key -> { data, fetcher }. `fetcher` is remembered so invalidate() can re-run it. */
const entries = new Map()
/** key -> Promise, so N screens mounting at once share one request. */
const inflight = new Map()
/** key -> Set<fn>, notified whenever a key's data changes. */
const listeners = new Map()
// key -> monotonic request number. A forced refetch must win over an older in-flight read
// regardless of which lands first, or a slow pre-write read overwrites post-write data.
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

// Optimistic write: set a key's value now, before the server confirms it. The version bump
// supersedes any read already in flight, so a response fetched before this change can't land
// after it and put the old value back. The write's own invalidation then settles the truth.
export function setQueryData(key, update) {
  const existing = entries.get(key)
  // Nothing loaded yet means nothing on screen to update; the read in flight will bring it.
  if (existing?.data === undefined) return
  const data = typeof update === 'function' ? update(existing.data) : update
  versions.set(key, (versions.get(key) ?? 0) + 1)
  entries.set(key, { ...existing, data })
  emit(key, data)
}

// A key plus everything scoped under it: `sets` also covers `sets:session:<id>`. Writes
// invalidate by table, so a per-session read can never be forgotten by a write that
// doesn't know which session it touched.
function withChildren(keys) {
  const out = new Set()
  for (const key of keys) {
    out.add(key)
    for (const k of entries.keys()) if (k.startsWith(`${key}:`)) out.add(k)
  }
  return out
}

// Mark keys as changed and refetch now. The cached value is kept until the fresh one lands,
// so a screen showing it updates in place instead of blinking back to a spinner.
export function invalidate(...keys) {
  for (const key of withChildren(keys)) {
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

// Drop keys whose rows no longer exist, so later invalidations stop re-reading a deleted
// session — each of those reads would fail, quietly, forever.
export function forget(...keys) {
  for (const key of keys) {
    entries.delete(key)
    inflight.delete(key)
    versions.set(key, (versions.get(key) ?? 0) + 1)
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
  plans: 'plans',
  // Scoped under their table's key, so a write to that table refreshes them too.
  session: (id) => `sessions:${id}`,
  sessionSets: (id) => `sets:session:${id}`,
}
