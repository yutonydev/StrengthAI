import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowUp, CalendarPlus, Dumbbell, Sparkles } from 'lucide-react'
import { askCoach, loadCoachFacts } from '@/api/coachChat'
import { sets as setsApi } from '@/api/db'
import { useQuery } from '@/hooks/useQuery'
import { qk } from '@/api/queryCache'
import { ErrorBanner } from '@/components/ScreenState'
import { CHAT_KEY } from '@/lib/localState'

// The chat coach. The model sees a facts payload from buildCoachFacts and never touches the
// database, so every number it quotes came from a tested function over real sets. It can
// create a template and stage exercises; it cannot write a weight, a rep count or an RIR.
// Facts are recomputed on every send — a stale payload is wrong in the worst way: it looks
// right.

// Opening suggestions have to be answerable BY THIS LIFTER. Two of these used to ask about
// their history unconditionally, so a new account's most prominent prompt spent a model
// call being told there was no data. The set now depends on whether anything is logged.
const STARTERS_WITH_HISTORY = [
  'Why has my bench stalled?',
  'Am I doing enough back volume?',
  'Build me a push day',
  'How close to failure should I train?',
]

const STARTERS_NEW = [
  'How do I know when to add weight?',
  'How much volume does a muscle need?',
  'What does RIR actually measure?',
  'How close to failure should I train?',
]

/** Height of the floating BottomNav, so the composer sits directly on top of it. */
const NAV_H = 62

// The thread survives a reload. Everything else in the app persists, and a chat that
// vanished on refresh was the one place the lifter could lose something they typed.
// localStorage rather than a table — same choice the rest timer makes: it is device-local
// working state, nothing here is a fact not already derivable from their sets, and a table
// would need a migration, an RLS policy and a retention answer for model-written content.
// The key lives in lib/localState.js, which also clears it on sign-out.
/** Keeps the stored thread bounded; the server only sends the last 20 turns anyway. */
const CHAT_CAP = 40

function loadThread() {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Corrupt or unreadable (private mode, quota, a half-written value) is not worth
    // surfacing — an empty thread is a working screen, an exception is a blank one.
    localStorage.removeItem(CHAT_KEY)
    return []
  }
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-[5px] px-1 py-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[6px] w-[6px] rounded-full bg-muted-graphic"
          style={{ animation: `coachdot 1.2s ${i * 0.18}s infinite ease-in-out` }}
        />
      ))}
      <style>{`@keyframes coachdot{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}`}</style>
    </div>
  )
}

// What the coach did, rendered from the tool result rather than its prose. If the model
// described creating something the tool never created, the card is what the lifter believes.
function ActionCard({ toolCall, onOpen }) {
  const { name, result } = toolCall
  if (!result?.ok) {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-[14px] border border-[#F2B544]/[0.32] bg-[#F2B544]/[0.06] p-3">
        <AlertTriangle className="mt-[1px] h-[15px] w-[15px] shrink-0 text-[#F2B544]" />
        <div className="text-[12.5px] leading-[1.5] text-[#C7CCC6]">
          {result?.reason ?? 'That did not save.'}
        </div>
      </div>
    )
  }

  const isTemplate = name === 'create_template'
  const Icon = isTemplate ? Dumbbell : CalendarPlus
  const count = result.variantIds?.length ?? 0

  return (
    <button
      onClick={onOpen}
      className="mt-2 flex w-full items-center gap-[10px] rounded-[14px] border border-[#A8C9A2]/[0.28] bg-[#A8C9A2]/[0.05] p-[13px] text-left"
    >
      <Icon className="h-[17px] w-[17px] shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold">
          {isTemplate ? result.template?.name : result.created ? 'Workout started' : 'Added to your workout'}
        </div>
        <div className="mt-[2px] text-[11.5px] text-muted-foreground">
          {count} exercise{count === 1 ? '' : 's'} · tap to open
        </div>
      </div>
    </button>
  )
}

export default function CoachChat() {
  const navigate = useNavigate()
  // Read through the shared cache — Home and Progress already hold this key, so on any
  // warm cache picking the right starters costs nothing. `loading` is deliberately not
  // gated on: the general set is the safe default while the count is unknown.
  const setsQ = useQuery(qk.sets, () => setsApi.all())
  const starters = (setsQ.data ?? []).length > 0 ? STARTERS_WITH_HISTORY : STARTERS_NEW

  const [messages, setMessages] = useState(loadThread)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-CHAT_CAP)))
    } catch {
      // A full or unavailable store must not break the conversation in front of the lifter.
    }
  }, [messages])

  const openAction = (toolCall) => {
    const { name, result } = toolCall
    if (!result?.ok) return
    if (name === 'create_template' && result.template?.id) navigate(`/template/${result.template.id}`)
    if (name === 'stage_session' && result.session?.id) navigate(`/workout/${result.session.id}`)
  }

  const send = async (text) => {
    const content = String(text ?? '').trim()
    if (!content || sending) return

    setError(null)
    setInput('')
    const history = [...messages, { role: 'user', content }]
    setMessages(history)
    setSending(true)

    try {
      const facts = await loadCoachFacts()
      // Only role/content goes to the model — the action cards are local render state.
      const reply = await askCoach(
        history.map(({ role, content }) => ({ role, content })),
        facts
      )

      if (reply.status !== 'answered') {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: reply.reason, tone: reply.status === 'capped' ? 'capped' : 'error' },
        ])
        return
      }

      setMessages((m) => [...m, { role: 'assistant', content: reply.text, toolCall: reply.toolCall }])

      // Staging exercises is a request to go and train them, so the session is where the
      // lifter wants to be. Delayed just enough to read the reply that explains why.
      if (reply.toolCall?.name === 'stage_session' && reply.toolCall.result?.ok) {
        const id = reply.toolCall.result.session?.id
        if (id) setTimeout(() => navigate(`/workout/${id}`), 1200)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const empty = messages.length === 0

  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="px-[18px] pt-[14px]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[22px] font-bold tracking-[-0.025em]">Coach</div>
          <div className="flex shrink-0 items-center gap-[14px]">
            {!empty && (
              <button
                onClick={() => setMessages([])}
                className="text-[11.5px] font-semibold text-muted-foreground"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => navigate('/coach/insights')}
              className="text-[11.5px] font-semibold text-primary"
            >
              Insights
            </button>
          </div>
        </div>
        <div className="mt-1 text-[12.5px] leading-[1.45] text-muted-foreground">
          Ask about your training or about lifting in general. Anything it says about you comes
          from sets you logged.
        </div>
      </div>

      <ErrorBanner error={error} className="mx-[18px] mt-3" />

      <div className="px-[18px] pt-[18px]" style={{ paddingBottom: `${NAV_H + 78}px` }}>
        {empty && (
          <div className="flex flex-col items-start gap-[10px]">
            <div className="flex items-center gap-[7px] text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Sparkles className="h-[15px] w-[15px] text-primary" />
              Try asking
            </div>
            {starters.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                className="rounded-full border border-border px-[13px] py-[8px] text-left text-[12.5px] text-[#C7CCC6]"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-[14px]">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-[16px] rounded-br-[6px] bg-primary/[0.12] px-[13px] py-[10px] text-[13.5px] leading-[1.55] text-[#ECEFEA]">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex flex-col items-start">
                <div
                  className="max-w-[92%] rounded-[16px] rounded-bl-[6px] border px-[13px] py-[10px] text-[13.5px] leading-[1.6] whitespace-pre-wrap"
                  style={
                    m.tone === 'capped' || m.tone === 'error'
                      ? { borderColor: 'rgba(242,181,68,.32)', background: 'rgba(242,181,68,.06)', color: '#C7CCC6' }
                      : { borderColor: '#272C29', background: '#171A18', color: '#ECEFEA' }
                  }
                >
                  {m.content}
                </div>
                {m.toolCall && (
                  <div className="w-full max-w-[92%]">
                    <ActionCard toolCall={m.toolCall} onOpen={() => openAction(m.toolCall)} />
                  </div>
                )}
              </div>
            )
          )}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-[16px] rounded-bl-[6px] border border-border bg-card px-[11px] py-[10px]">
                <ThinkingDots />
              </div>
            </div>
          )}
        </div>

        <div ref={endRef} />
      </div>

      <div className="fixed inset-x-0 z-20 flex justify-center" style={{ bottom: `calc(var(--safe-bottom) + ${NAV_H}px)` }}>
        <div className="w-full max-w-[440px] border-t border-accent bg-background/[0.92] px-[18px] py-[10px] backdrop-blur-[16px]">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
            className="flex items-end gap-[8px]"
          >
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              placeholder="Ask the coach…"
              className="max-h-[120px] flex-1 resize-none rounded-[11px] border border-border bg-card px-[12px] py-[10px] text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/40"
            />
            <button
              type="submit"
              aria-label="Send message"
              disabled={!input.trim() || sending}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-primary text-[#12160B] disabled:opacity-35"
            >
              <ArrowUp className="h-[18px] w-[18px]" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
