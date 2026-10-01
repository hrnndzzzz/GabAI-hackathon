import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Sheet } from './Sheet'
import { TONE_BG, cx, type Tone } from './ui'

export interface SelectOption<T extends string> {
  value: T
  label: string
  hint?: string
  tone?: Tone
}

/** Dropdown that opens a bottom sheet, so long colour-coded lists stay readable on a phone. */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  tone,
  disabled,
  className,
}: {
  label: string
  value: T | null
  options: SelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  /** Fill the closed control with this tone (e.g. the chosen level's colour). */
  tone?: Tone
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  const fill = tone ?? current?.tone
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${label}: ${current?.label ?? placeholder}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cx(
          'press flex h-11 w-full min-w-0 items-center gap-2 rounded-lg border-2 border-ink px-2.5 text-left shadow-brut-sm disabled:opacity-50 disabled:shadow-none',
          fill && current ? TONE_BG[fill] : 'bg-surface',
          className,
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9px] leading-none font-bold tracking-wider uppercase opacity-70">{label}</span>
          <span className={cx('mt-0.5 block truncate text-[13.5px] leading-tight font-bold', !current && 'text-subtle')}>
            {current?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown size={16} strokeWidth={2.5} aria-hidden className="shrink-0" />
      </button>
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)}>
          <ul role="listbox" aria-label={label} className="space-y-2">
            {options.map((o) => {
              const on = o.value === value
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => {
                      onChange(o.value)
                      setOpen(false)
                    }}
                    className={cx(
                      'press flex w-full items-center gap-3 rounded-lg border-2 border-ink px-3 py-2.5 text-left shadow-brut-sm',
                      on && o.tone ? TONE_BG[o.tone] : 'bg-surface',
                    )}
                  >
                    {o.tone && <span className={cx('size-3.5 shrink-0 rounded-full border-2 border-ink', TONE_BG[o.tone])} aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold">{o.label}</span>
                      {o.hint && <span className="block text-xs opacity-75">{o.hint}</span>}
                    </span>
                    {on && <Check size={17} strokeWidth={3} aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ul>
        </Sheet>
      )}
    </>
  )
}
