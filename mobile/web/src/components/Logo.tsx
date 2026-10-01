import type { ReactNode } from 'react'
import { cx } from './ui'

/** Scan-frame corners around an AI sparkle: capture plus synthesis. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden>
      <rect x="2" y="2" width="44" height="44" rx="11" fill="#4D96FF" stroke="#1A1A1A" strokeWidth="3" />
      <path
        d="M11 18v-7h7M30 11h7v7M37 30v7h-7M18 37h-7v-7"
        fill="none"
        stroke="#1A1A1A"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24 14c.7 5.6 3.4 8.3 9 9-5.6.7-8.3 3.4-9 9-.7-5.6-3.4-8.3-9-9 5.6-.7 8.3-3.4 9-9z"
        fill="#FFD93D"
        stroke="#1A1A1A"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Brand mark with a live slot on the right (the clock, or a running exam timer). */
export function BrandPill({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-brand py-1 pr-1 pl-1 shadow-brut-sm',
        className,
      )}
    >
      <LogoMark size={22} />
      <span className="text-[15px] leading-none font-extrabold tracking-tight">GabAI</span>
      {children}
    </span>
  )
}
