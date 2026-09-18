import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[boundary] render failed', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        className={`flex ${this.props.full ? 'min-h-dvh' : 'min-h-full'} flex-col items-center justify-center gap-[10px] bg-background px-6 text-center`}
      >
        <div className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          This screen hit an error
        </div>
        <div className="max-w-[290px] text-[12.5px] leading-[1.5] text-muted-foreground">
          Nothing you logged is lost — it is saved as you go. Reloading usually clears this.
        </div>
        <div className="mt-[2px] max-w-full overflow-hidden rounded-[11px] border border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {String(error?.message || error).slice(0, 160)}
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-[6px] rounded-[11px] bg-primary px-[18px] py-[10px] text-[12.5px] font-bold text-primary-foreground"
        >
          Reload
        </button>
      </div>
    )
  }
}
