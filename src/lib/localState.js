/**
 * Device-local working state, and the one place that knows how to drop all of it.
 *
 * These are the things held outside the database because they are about this device rather
 * than about the lifter's training: a rest countdown that has to survive the screen locking
 * between sets, and the chat thread.
 *
 * They must be cleared on sign-out for the same reason the query cache is (see db.js): a
 * shared or handed-on phone would otherwise show the next account the previous one's
 * conversation. The cache already had this covered; localStorage did not, and it is the
 * more durable of the two — a page reload clears module scope, but not this.
 */

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
