/**
 * The two pieces of chrome every screen needs: a loading placeholder and an error banner.
 *
 * Both were copy-pasted into seven and eight files respectively, with the class lists drifting
 * slightly as they went — `min-h-full` on the tab screens, `min-h-svh` on the full-page ones,
 * and no single place to change how a failure reads.
 */

/**
 * Full-screen loading placeholder.
 *
 * @param {boolean} full `min-h-svh` for routes that own the whole viewport (Settings, the
 *   editors, session detail); the default `min-h-full` is for tab screens, which sit inside
 *   AppShell's already-sized column.
 */
export function ScreenLoading({ full = false }) {
  return (
    <div
      className={`flex ${full ? 'min-h-svh' : 'min-h-full'} items-center justify-center bg-background text-muted-foreground`}
    >
      Loading…
    </div>
  )
}

/**
 * Inline failure banner. Renders nothing when there is no error, so call sites can drop it in
 * unconditionally rather than repeating `{error && (...)}`.
 *
 * `className` carries the per-screen spacing, which genuinely differs: screens whose first
 * child is the banner want a bottom margin, ones inside a flex-gap column want none.
 */
export function ErrorBanner({ error, className = '' }) {
  if (!error) return null
  return (
    <div
      className={`rounded-[14px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive ${className}`}
    >
      {error}
    </div>
  )
}
