import { ChevronRight } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../lib/back'
import { MonoLabel, TONE_BG, cx, type Tone } from './ui'

const HOLD_MS = 380
const GAP = 10

/**
 * Press and hold a badge to peek at what it counts, like 3D / Haptic Touch: the badge lifts,
 * the screen dims and a preview card opens beside it. A normal tap still reaches the parent
 * (the category header), and the preview stays open after lifting so its rows can be tapped.
 */
export function Peek({ title, children, content }: { title: string; children: ReactNode; content: (close: () => void) => ReactNode }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const close = () => setAnchor(null)
  useBackHandler(anchor !== null, close)

  function down(e: PointerEvent) {
    if (e.button > 0) return
    fired.current = false
    origin.current = { x: e.clientX, y: e.clientY }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      fired.current = true
      navigator.vibrate?.(12)
      setAnchor(ref.current?.getBoundingClientRect() ?? null)
    }, HOLD_MS)
  }
  const cancel = () => window.clearTimeout(timer.current)

  return (
    <>
      <span
        ref={ref}
        onPointerDown={down}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onPointerMove={(e) => {
          if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8) cancel()
        }}
        // The release after a peek must not also toggle the category underneath.
        onClickCapture={(e) => {
          if (!fired.current) return
          fired.current = false
          e.preventDefault()
          e.stopPropagation()
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="inline-flex touch-manipulation select-none [-webkit-touch-callout:none]"
      >
        {children}
      </span>
      {anchor && createPortal(<PeekCard anchor={anchor} title={title} badge={children} onClose={close}>{content(close)}</PeekCard>, document.body)}
    </>
  )
}

function PeekCard({ anchor, title, badge, onClose, children }: { anchor: DOMRect; title: string; badge: ReactNode; onClose: () => void; children: ReactNode }) {
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
    <div className="fixed inset-0 z-[60]" role="presentation">
      <button type="button" aria-label="Close preview" onClick={onClose} className="absolute inset-0 cursor-default bg-black/35 backdrop-blur-[2px]" />
      {/* The pressed badge, lifted above the dimmed screen. */}
      <span className="pointer-events-none fixed origin-center scale-110" style={{ left: anchor.left, top: anchor.top }} aria-hidden>
        {badge}
      </span>
      <div
        ref={card}
        role="dialog"
        aria-label={title}
        className={cx(
          'fixed flex w-[min(320px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border-2 border-ink bg-surface shadow-brut-lg',
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
  const cls = 'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left'
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, 'active:bg-canvas')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Totals line at the bottom of a peek card, so the badge's number can be checked at a glance. */
export function PeekTotal({ children }: { children: ReactNode }) {
  return <p className="mt-1 border-t-2 border-dashed border-ink/20 px-2 pt-2 pb-1 text-[11.5px] font-semibold text-subtle">{children}</p>
}
