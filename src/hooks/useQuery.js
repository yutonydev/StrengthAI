import { useEffect, useState } from 'react'
import { fetchQuery, getCached, subscribe } from '@/api/queryCache'

// Read one cached query. `loading` is true only when there is nothing cached to show, so a
// revisited screen renders on the first frame and revalidates silently behind it.
// `fetcher` is read on mount only and re-run later by invalidate() — keep it free of
// component state, where a stale closure would be invisible.
export function useQuery(key, fetcher) {
  const cached = getCached(key)
  const [data, setData] = useState(cached?.data)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(cached?.data === undefined)

  useEffect(() => {
    let alive = true

    // Subscribe before fetching, so a refresh triggered by someone else's write while
    // this screen is mounted lands here too.
    const unsubscribe = subscribe(key, (next) => {
      if (!alive) return
      setData(next)
      setLoading(false)
    })

    fetchQuery(key, fetcher)
      .then(() => alive && setError(null))
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false))

    return () => {
      alive = false
      unsubscribe()
    }
    // fetcher is intentionally not a dependency: it is a fresh arrow every render, and
    // depending on it would refetch on every render forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, error, loading }
}
