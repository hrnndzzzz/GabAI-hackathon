import { ChevronRight } from 'lucide-react'
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../lib/back'
import { MonoLabel, TONE_BG, cx, type Tone } from './ui'

const HOLD_MS = 380
const GAP = 10

/** The row currently under the finger while peeking. */
const HotRow = createContext<string | null>(null)

function rowAt(x: number, y: number): HTMLElement | null {
  return (document.elementFromPoint(x, y)?.closest('[data-peek-row]') as HTMLElement | null) ?? null
}

/** The click the browser sends after the finger lifts must not land on whatever is underneath. */
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 600)
}

/**
 * Press and hold a badge to peek at what it counts, like 3D Touch: the badge lifts, the screen
 * dims and a preview opens. Keep holding and slide onto a row to pick it, then let go to open it;
 * let go anywhere else to close. A normal tap still opens the category underneath.
 */
export function Peek({ title, children, content }: { title: string; children: ReactNode; content: (close: () => void) => ReactNode }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [hot, setHot] = useState<string | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const hotRef = useRef<string | null>(null)
  const close = () => {
    fired.current = false
    hotRef.current = null
    setHot(null)
    setAnchor(null)
  }
  useBackHandler(anchor !== null, close)

  // While peeking, sliding the finger picks rows instead of scrolling the page underneath.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const block = (e: TouchEvent) => {
      if (fired.current) e.preventDefault()
    }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [])

  function down(e: PointerEvent<HTMLSpanElement>) {
    if (e.button > 0) return
    fired.current = false
    origin.current = { x: e.clientX, y: e.clientY }
    // Keep receiving the gesture even when the finger leaves the badge (touch does this already).
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Pointer already gone (or not capturable): touch keeps the gesture on the badge anyway.
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      fired.current = true
      navigator.vibrate?.(12)
      setAnchor(ref.current?.getBoundingClientRect() ?? null)
    }, HOLD_MS)
  }

  function move(e: PointerEvent) {
    if (!fired.current) {
      // Moving before the hold completes is a scroll or a swipe, not a peek.
      if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8) window.clearTimeout(timer.current)
      return
    }
    const id = rowAt(e.clientX, e.clientY)?.dataset.peekRow ?? null
    if (id === hotRef.current) return
    hotRef.current = id
    setHot(id)
    if (id) navigator.vibrate?.(6)
  }

  function up(e: PointerEvent) {
    window.clearTimeout(timer.current)
    if (!fired.current) return
    // Letting go on a row opens it; anywhere else just closes the preview.
    rowAt(e.clientX, e.clientY)?.click()
    swallowNextClick()
    close()
  }

  function cancelled() {
    window.clearTimeout(timer.current)
    if (!fired.current) return
    swallowNextClick()
    close()
  }

  return (
    <>
      <span
        ref={ref}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancelled}
        // Belt and braces: the release after a peek never toggles the category underneath.
        onClickCapture={(e) => {
          if (anchor === null && !fired.current) return
          e.preventDefault()
          e.stopPropagation()
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="inline-flex touch-manipulation select-none [-webkit-touch-callout:none]"
      >
        {children}
      </span>
      {anchor &&
        createPortal(
          <HotRow.Provider value={hot}>
            <PeekCard anchor={anchor} title={title} badge={children}>
              {content(close)}
            </PeekCard>
          </HotRow.Provider>,
          document.body,
        )}
    </>
  )
}

function PeekCard({ anchor, title, badge, children }: { anchor: DOMRect; title: string; badge: ReactNode; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    // Keep the card inside the phone-width app column, below the badge when there is room.
    const app = document.querySelector('#root > div')?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight)
    const width = card.current?.offsetWidth ?? 320
    const left = Math.min(Math.max(anchor.right - width, app.left + 12), app.right - 12 - width)
    const below = innerHeight - anchor.bottom - GAP - 12
    const above = anchor.top - GAP - 12
    const height = card.current?.scrollHeight ?? 300
    if (below >= Math.min(height, 280) || below >= above) setPos({ left, top: anchor.bottom + GAP, maxHeight: below })
    else setPos({ left, top: Math.max(12, anchor.top - GAP - Math.min(height, above)), maxHeight: above })
  }, [anchor])

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] select-none" role="presentation">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" />
      {/* The pressed badge, lifted above the dimmed screen. */}
      <span className="fixed origin-center scale-110" style={{ left: anchor.left, top: anchor.top }} aria-hidden>
        {badge}
      </span>
      <div
        ref={card}
        role="dialog"
        aria-label={title}
        className={cx(
          'pointer-events-auto fixed flex w-[min(320px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border-2 border-ink bg-surface shadow-brut-lg',
          pos ? 'animate-peek-in' : 'invisible',
        )}
        style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight, transformOrigin: 'top right' } : { left: 0, top: 0 }}
      >
        <MonoLabel className="shrink-0 border-b-2 border-ink px-3 py-2">{title}</MonoLabel>
        <div className="min-h-0 overflow-y-auto p-2">{children}</div>
      </div>
    </div>
  )
}

/** One tappable line in a peek card: colour dot, title, detail and an optional count. */
export function PeekRow({ tone, title, detail, count, onClick }: { tone?: Tone; title: string; detail?: string; count?: string; onClick?: () => void }) {
  const id = useId()
  const hot = useContext(HotRow) === id
  const body = (
    <>
      {tone && <span className={cx('size-2.5 shrink-0 rounded-full border border-ink', TONE_BG[tone])} aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-tight font-bold">{title}</span>
        {detail && <span className="mt-0.5 block truncate text-[11.5px] text-subtle">{detail}</span>}
      </span>
      {count && <span className="shrink-0 font-mono text-[12px] font-extrabold">{count}</span>}
      {onClick && <ChevronRight size={15} aria-hidden className="shrink-0" />}
    </>
  )
  const cls = 'flex w-full items-center gap-2.5 rounded-lg border-2 px-2 py-2 text-left transition-colors'
  return onClick ? (
    <button type="button" data-peek-row={id} onClick={onClick} className={cx(cls, hot ? 'border-ink bg-sun text-[#1a1a1a]' : 'border-transparent')}>
      {body}
    </button>
  ) : (
    <div className={cx(cls, 'border-transparent')}>{body}</div>
  )
}

/** Totals line at the bottom of a peek card, so the badge's number can be checked at a glance. */
export function PeekTotal({ children }: { children: ReactNode }) {
  return <p className="mt-1 border-t-2 border-dashed border-ink/20 px-2 pt-2 pb-1 text-[11.5px] font-semibold text-subtle">{children}</p>
}
