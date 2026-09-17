import logo from '@/assets/logo.png'

/** The branded wait, shown while the session restores and the tab chunks and query cache warm. */
export function Preloader() {
  // <output> carries role="status" implicitly, so the screen announces instead of sitting silent.
  return (
    <output
      aria-label="Loading StrengthAI"
      className="flex min-h-svh flex-col items-center justify-center bg-background text-foreground"
    >
      {/* Decorative: the wordmark below already says the name. */}
      <img src={logo} alt="" className="preloader-mark h-[68px] w-[68px] rounded-2xl object-cover" />
      <div className="preloader-word mt-[18px] text-[22px] font-bold tracking-[-0.03em]">StrengthAI</div>
      <div className="preloader-tagline mt-[5px] text-[13px] text-muted-foreground">Train Smarter</div>
    </output>
  )
}
