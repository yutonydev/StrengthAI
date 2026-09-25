import { useEffectEvent, useLayoutEffect, useState } from 'react'
import { fetchQuery, getCached } from '@/api/queryCache'

// Loads data into a screen's own editable state — the live workout, a template, settings.
// useQuery would push every background refresh straight into the screen, over the top of an
// edit in progress; this hands the data over and then gets out of the way.
//
// When every key is cached the data is applied before the first paint, so a revisit shows no
// spinner. It always revalidates, but applies the fresh read only if it differs from what was
// seeded: identical data changes nothing, and a real difference means another device changed
// it, which should beat a stale copy.
//
// `queries` is [[key, fetcher, fallback?]]. With a fallback, a failed read resolves to it
// instead of failing the screen. `scope` re-runs the load when something outside the keys
// changes (a route param the fetchers don't encode).
//
// `apply(values, { fromCache })`: a cached copy can be stale, so a decision like "this row
// doesn't exist, leave" should wait for `fromCache: false` — a template created a moment ago
// isn't in the cached list yet.
export function useSeed(queries, apply, scope = '') {
  const allCached = () => queries.every(([key]) => getCached(key)?.data !== undefined)
  // Starts true even when everything is cached: the data reaches the screen's state in the
  // layout effect below, after the first render. Reporting "loaded" before then rendered
  // Settings with a null profile and crashed it. The effect runs before paint, so this
  // loading render is never seen.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const onData = useEffectEvent(apply)
  const id = `${scope}|${queries.map(([key]) => key).join('|')}`

  useLayoutEffect(() => {
    let alive = true
    let seeded = null
    if (allCached()) {
      const values = queries.map(([key]) => getCached(key).data)
      seeded = JSON.stringify(values)
      onData(values, { fromCache: true })
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError(null)

    Promise.all(
      queries.map(([key, fetcher, fallback]) => {
        const read = fetchQuery(key, fetcher)
        return fallback === undefined ? read : read.catch(() => fallback)
      })
    )
      .then((values) => {
        if (!alive || JSON.stringify(values) === seeded) return
        onData(values, { fromCache: false })
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false))

    return () => {
      alive = false
    }
    // `id` is the identity of this load; `queries` is a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return { loading, error }
}
