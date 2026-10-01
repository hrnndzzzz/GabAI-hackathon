import { useRef, useState, type ReactNode } from 'react'

/** Swipe sideways past the threshold to dismiss; a tap still works as a normal press. */
export function SwipeRow({ onDismiss, children, label }: { onDismiss: () => void; children: ReactNode; label: string }) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState(false)

  return (
    <div
      className="touch-pan-y"
      style={{
        transform: `translateX(${leaving ? (dx < 0 ? -420 : 420) : dx}px)`,
        opacity: leaving ? 0 : 1 - Math.min(Math.abs(dx) / 260, 0.6),
        transition: start.current ? 'none' : 'transform 180ms ease, opacity 180ms ease',
      }}
      aria-label={label}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const x = e.clientX - start.current.x
        if (Math.abs(x) > Math.abs(e.clientY - start.current.y)) setDx(x)
      }}
      onPointerUp={() => {
        start.current = null
        if (Math.abs(dx) > 90) {
          setLeaving(true)
          setTimeout(onDismiss, 170)
        } else {
          setDx(0)
        }
      }}
      onPointerCancel={() => {
        start.current = null
        setDx(0)
      }}
      onClickCapture={(e) => {
        // A drag is not a tap.
        if (Math.abs(dx) > 6) e.stopPropagation()
      }}
    >
      {children}
    </div>
  )
}
