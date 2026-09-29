// Every analytics event passes through here before it leaves the browser. Vercel's script
// sends location.href whole, and Supabase's password-recovery link carries a live access
// token in the URL, so the query string and hash are always dropped. Row ids are folded to
// `:id` so /workout/<uuid> counts as one page, not one page per workout.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export function scrubAnalyticsEvent(event) {
  let url
  try {
    url = new URL(event.url)
  } catch {
    // Unparseable means unknown contents; send nothing rather than risk a token.
    return null
  }
  url.pathname = url.pathname.replace(UUID, ':id')
  url.search = ''
  url.hash = ''
  return { ...event, url: url.toString() }
}
