import {
  flags as flagsApi,
  muscleGoals,
  profile as profileApi,
  readiness as readinessApi,
  sessions,
  sets as setsApi,
  templates as templatesApi,
  variants as variantsApi,
} from '@/api/db'
import { fetchQuery, qk } from '@/api/queryCache'

// Every key the four tab screens read, with the same fetchers they use.
const WARM = [
  [qk.profile, () => profileApi.get()],
  [qk.activeSession, () => sessions.active()],
  [qk.sessions, () => sessions.list()],
  [qk.sets, () => setsApi.all()],
  [qk.variants, () => variantsApi.list()],
  [qk.muscleGoals, () => muscleGoals.list()],
  [qk.templates, () => templatesApi.list()],
  [qk.readiness, () => readinessApi.list()],
  [qk.excludedFlags, () => flagsApi.byStatus('excluded')],
]

/** Fill the query cache for every tab screen; never rejects, so one dead key cannot stall the warm-up. */
export function warmTabData() {
  return Promise.all(WARM.map(([key, fetcher]) => fetchQuery(key, fetcher).catch(() => {})))
}
