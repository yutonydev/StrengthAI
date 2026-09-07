import { Dialog } from '@base-ui/react/dialog'

// Shared slide-up sheet chrome. Base UI's Dialog portals to document.body, escaping
// AppShell's 440px column, so width and centering are repeated here explicitly.
export function Sheet({ open, onOpenChange, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Popup
          className="fixed bottom-0 left-1/2 z-50 max-h-[85svh] w-full max-w-[440px] -translate-x-1/2 overflow-y-auto rounded-t-[22px] border-t border-x border-accent bg-[#141715] text-foreground"
          style={{ paddingBottom: 'calc(22px + var(--safe-bottom))' }}
        >
          <div className="mx-auto mt-[10px] mb-1 h-1 w-9 rounded-full bg-[#313632]" />
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
