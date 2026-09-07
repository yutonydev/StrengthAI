// Constrains every screen to a phone-width column — invisible on a phone, a deliberate
// column on desktop. Safe-area insets live here once, since this column *is* the screen.
export function AppShell({ children }) {
  return (
    <div className="min-h-svh bg-[#0A0B0A]">
      <div
        className="mx-auto min-h-svh max-w-[440px] border-x border-accent bg-background"
        style={{
          paddingTop: 'var(--safe-top)',
          paddingBottom: 'var(--safe-bottom)',
          paddingLeft: 'var(--safe-left)',
          paddingRight: 'var(--safe-right)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
