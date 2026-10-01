import { ArrowLeft, Check, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { BrutalistButton, IconButton, MonoLabel, TONE_BG, accentVariant, cx, type Tone } from './ui'

export interface StepLink {
  label: string
  /** Undefined when that step is not reachable yet. */
  go?: () => void
}

/**
 * Step header for multi-screen flows. The back button wears the flow's colour; each
 * progress bar is a button that jumps to its step once it is reachable.
 */
export function FlowHeader({
  step,
  total,
  label,
  title,
  tone,
  steps,
  onDone,
}: {
  step: number
  total: number
  label: string
  title: string
  tone: Tone
  steps?: StepLink[]
  /** Show "Done" instead of the close X (last step of a flow). */
  onDone?: () => void
}) {
  const back = useStore((s) => s.back)
  const resetTo = useStore((s) => s.resetTo)
  return (
    <header className="shrink-0 border-b-2 border-ink bg-canvas px-4 pt-3 pb-3">
      <div className="flex items-center gap-3">
        <IconButton label="Back" icon={ArrowLeft} tone={tone} onClick={() => back()} />
        <div className="min-w-0 flex-1">
          <MonoLabel className="truncate text-subtle">
            Step {String(step).padStart(2, '0')} / {String(total).padStart(2, '0')} • {label}
          </MonoLabel>
          <h1 className="truncate text-[17px] leading-tight font-extrabold">{title}</h1>
        </div>
        {onDone ? (
          <BrutalistButton size="sm" variant={accentVariant(tone)} icon={Check} onClick={onDone}>
            Done
          </BrutalistButton>
        ) : (
          <IconButton label="Close and return to hub" icon={X} onClick={() => resetTo(['hub'])} />
        )}
      </div>
      <nav aria-label="Steps" className="mt-3 flex gap-1.5">
        {Array.from({ length: total }, (_, i) => {
          const link = steps?.[i]
          const here = i === step - 1
          return (
            <button
              key={i}
              type="button"
              disabled={!link?.go || here}
              aria-current={here ? 'step' : undefined}
              aria-label={`Step ${i + 1}${link ? `: ${link.label}` : ''}`}
              onClick={link?.go}
              className="group flex-1 py-1.5 disabled:cursor-default"
            >
              <span
                className={cx(
                  'block h-2 rounded-full border-2 border-ink transition-transform',
                  i < step ? TONE_BG[tone] : 'bg-surface',
                  link?.go && !here && 'group-active:translate-y-px',
                )}
              />
            </button>
          )
        })}
      </nav>
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

/** Back + primary action, the standard footer for a flow step. */
export function StepButtons({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-3">
      <BrutalistButton size="lg" variant="secondary" icon={ArrowLeft} aria-label="Previous step" onClick={onBack} className="px-3.5" />
      {children}
    </div>
  )
}

/** Plain header for single screens (settings, records, timer…): coloured back button + title. */
export function ScreenHeader({ title, label, tone = 'white', aside }: { title: string; label?: string; tone?: Tone; aside?: ReactNode }) {
  const back = useStore((s) => s.back)
  return (
    <header className="flex shrink-0 items-center gap-3 border-b-2 border-ink bg-canvas px-4 pt-3 pb-3">
      <IconButton label="Back" icon={ArrowLeft} tone={tone} onClick={() => back()} />
      <div className="min-w-0 flex-1">
        {label && <MonoLabel className="truncate text-subtle">{label}</MonoLabel>}
        <h1 className="truncate text-[17px] leading-tight font-extrabold">{title}</h1>
      </div>
      {aside}
    </header>
  )
}
