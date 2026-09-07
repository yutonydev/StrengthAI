// Device-local working state — a rest countdown that must survive the screen locking, and
// the chat thread — plus the one place that drops all of it. Cleared on sign-out for the
// same reason the query cache is, and it matters more: a reload clears module scope, not
// localStorage, so a handed-on phone would show the next account the previous conversation.

/** Rest countdown deadline, so a reload mid-set resumes rather than resets. */
export const REST_KEY = 'strengthai.rest'

/** The coach chat thread. */
export const CHAT_KEY = 'strengthai.chat'

const ALL = [REST_KEY, CHAT_KEY]

/** Drop every device-local key. Called on sign-out. */
export function clearLocalState() {
  for (const key of ALL) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Private mode or a disabled store — nothing was persisted either, so nothing to clear.
    }
  }
}
