import logo from '@/assets/logo.png'

/** The branded wait, shown while the session restores and the tab chunks and query cache warm. */
export function Preloader() {
  // <output> carries role="status" implicitly, so the screen announces instead of sitting silent.
  return (
    <output
      aria-label="Loading StrengthAI"
      className="flex min-h-dvh flex-col items-center justify-center bg-background text-foreground"
    >
      <div className="relative flex h-[210px] w-[210px] items-center justify-center">
        <div className="preloader-halo" aria-hidden="true" />
        <div className="preloader-ring" aria-hidden="true" />
        {/* Decorative: the wordmark below already says the name. */}
        <img
          src={logo}
          alt=""
          className="preloader-mark relative h-[72px] w-[72px] rounded-2xl object-cover"
        />
      </div>
      <div className="preloader-word mt-[-18px] text-[22px] font-bold tracking-[-0.03em]">StrengthAI</div>
      <div className="preloader-tagline mt-[5px] text-[13px] text-muted-foreground">Train Smarter</div>
    </output>
  )
}
