import { useMemo } from 'react'

/**
 * `id -> variant` lookup, memoised on the list.
 *
 * Six screens built this same Map by hand. Every one of them needs it for the same reason:
 * sessions and templates store `exercise_order` as an array of variant ids, so rendering any
 * of them means resolving ids to rows, and doing that with `.find()` inside a render is a
 * linear scan per exercise.
 *
 * @param {Array} variants
 * @returns {Map<string, object>}
 */
export function useVariantMap(variants) {
  return useMemo(() => new Map((variants ?? []).map((v) => [v.id, v])), [variants])
}
