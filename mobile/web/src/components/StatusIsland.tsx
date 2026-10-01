import { useEffect, useRef, useState } from 'react'
import { NET_LEVELS, useNetStatus, type NetLevel, type NetStatus } from '../lib/net'
import { cutoutX, showStatusRing } from '../lib/native'
import { cx } from './ui'

/** Discord-style presence dot: green online, yellow idle, red offline, blinking red reconnecting. */
export function StatusDot({ level, className }: { level: NetLevel; className?: string }) {
  const info = NET_LEVELS[level]
  return (
    <span
      role="img"
      aria-label={info.label}
      className={cx('block rounded-full border-[3px] border-canvas', info.dot, info.blink && 'animate-pulse', className)}
    />
  )
}

/**
 * A brief pill that drops from the camera hole when the online status changes, like a Dynamic
 * Island, while the Android shell rings the punch-hole camera in the same colour.
 */
export function StatusIsland() {
  const status = useNetStatus()
  const [shown, setShown] = useState<NetStatus | null>(null)
  const [x, setX] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // "Synced 2 min ago" ticking to "3 min ago" is not a status change.
  const key = `${status.level}|${status.detail.replace(/^Synced .*?(•|$)/, 'synced$1')}`

  useEffect(() => {
    const hole = cutoutX()
    const app = box.current?.parentElement?.getBoundingClientRect()
    setX(hole !== null && app ? hole - app.left : null)
  }, [])

  useEffect(() => {
    const ms = status.level === 'reconnecting' ? 4500 : 2600
    const info = NET_LEVELS[status.level]
    setShown(status)
    showStatusRing(info.hex, !!info.blink, ms)
    const t = window.setTimeout(() => setShown(null), ms)
    return () => window.clearTimeout(t)
    // Only a new status shows the island; the latest text is read when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <div ref={box} className="pointer-events-none absolute inset-x-0 top-0 z-[45] flex justify-center" aria-live="polite">
      {shown && (
        <div
          role="status"
          className="absolute top-1.5 flex h-8 max-w-[92%] -translate-x-1/2 animate-island-in items-center gap-2 rounded-full bg-[#101010] py-1 pr-3.5 pl-2 text-white shadow-[0_4px_14px_rgba(0,0,0,0.3)]"
          style={{ left: x ?? '50%' }}
        >
          <span className={cx('size-2.5 shrink-0 rounded-full', NET_LEVELS[shown.level].dot, NET_LEVELS[shown.level].blink && 'animate-pulse')} />
          <span className="shrink-0 text-[12.5px] font-extrabold">{shown.label}</span>
          <span className="min-w-0 truncate text-[12px] text-white/70">{shown.detail}</span>
        </div>
      )}
    </div>
  )
}
