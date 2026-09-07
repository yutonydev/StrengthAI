// The loading placeholder and error banner every screen needs. Both were copy-pasted into
// seven and eight files, with the class lists drifting as they went.

// Loading placeholder. `full` gives min-h-svh for routes that own the whole viewport; the
// default min-h-full is for tab screens inside AppShell's already-sized column.
export function ScreenLoading({ full = false }) {
  return (
    <div
      className={`flex ${full ? 'min-h-svh' : 'min-h-full'} items-center justify-center bg-background text-muted-foreground`}
    >
      Loading…
    </div>
  )
}

// Inline failure banner. Renders nothing without an error, so call sites can drop it in
// unconditionally. `className` carries per-screen spacing, which genuinely differs.
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
