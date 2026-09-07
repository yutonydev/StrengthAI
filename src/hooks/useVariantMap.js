import { useMemo } from 'react'

// `id -> variant` lookup, memoised on the list. Six screens built this by hand: sessions and
// templates store `exercise_order` as ids, and resolving those with `.find()` inside a
// render is a linear scan per exercise.
export function useVariantMap(variants) {
  return useMemo(() => new Map((variants ?? []).map((v) => [v.id, v])), [variants])
}
