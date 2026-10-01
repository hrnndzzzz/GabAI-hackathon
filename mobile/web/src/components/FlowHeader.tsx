import { ArrowLeft, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { IconButton, MonoLabel, TONE_BG, cx, type Tone } from './ui'

export function FlowHeader({
  step,
  total,
  label,
  title,
  tone,
}: {
  step: number
  total: number
  label: string
  title: string
  tone: Tone
}) {
  const back = useStore((s) => s.back)
  const resetTo = useStore((s) => s.resetTo)
  return (
    <header className="shrink-0 border-b-2 border-ink bg-canvas px-4 pt-3 pb-3">
      <div className="flex items-center gap-3">
        <IconButton label="Back" icon={ArrowLeft} onClick={() => back()} />
        <div className="min-w-0 flex-1">
          <MonoLabel className="truncate text-subtle">
            Step {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')} • {label}
          </MonoLabel>
          <h1 className="truncate text-[17px] leading-tight font-extrabold">{title}</h1>
        </div>
        <IconButton label="Close and return to hub" icon={X} onClick={() => resetTo(['hub'])} />
      </div>
      <div className="mt-3 flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cx('h-2 flex-1 rounded-full border-2 border-ink', i < step ? TONE_BG[tone] : 'bg-white')}
          />
        ))}
      </div>
    </header>
  )
}

export function FlowFooter({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <footer className="shrink-0 border-t-2 border-ink bg-canvas px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
      {note && <div className="mb-2">{note}</div>}
      {children}
    </footer>
  )
}
