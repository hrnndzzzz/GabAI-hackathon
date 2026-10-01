import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from 'react'

export type Tone = 'white' | 'yellow' | 'green' | 'coral' | 'blue' | 'canvas' | 'ink'

export const TONE_BG: Record<Tone, string> = {
  white: 'bg-surface',
  yellow: 'bg-sun',
  green: 'bg-mint',
  coral: 'bg-coral',
  blue: 'bg-brand',
  canvas: 'bg-canvas',
  ink: 'bg-ink text-surface',
}

const SHADOW = { none: '', sm: 'shadow-brut-sm', md: 'shadow-brut', lg: 'shadow-brut-lg' }

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function BrutalistCard({
  color = 'white',
  shadow = 'md',
  className,
  children,
  ref,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { color?: Tone; shadow?: keyof typeof SHADOW; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx('rounded-2xl border-2 border-ink', TONE_BG[color], SHADOW[shadow], className)} {...rest}>
      {children}
    </div>
  )
}

/** Tinted panel backgrounds for an accent tone. */
export const TONE_SOFT: Record<Tone, string> = {
  white: 'bg-surface',
  yellow: 'bg-sun/30',
  green: 'bg-mint/30',
  coral: 'bg-coral/25',
  blue: 'bg-brand/25',
  canvas: 'bg-canvas',
  ink: 'bg-ink/10',
}

/** Raw colours, for places a utility class can't reach (slider fill). */
export const TONE_HEX: Record<Tone, string> = {
  white: '#ffffff',
  yellow: '#ffd93d',
  green: '#6bcb77',
  coral: '#ff5964',
  blue: '#4d96ff',
  canvas: '#f8f9fa',
  ink: '#1a1a1a',
}

type Variant = 'primary' | 'secondary' | 'alert' | 'yellow' | 'green' | 'dark'

/** The solid button that matches a section's accent tone. */
export function accentVariant(tone: Tone): Variant {
  return tone === 'yellow' ? 'yellow' : tone === 'green' ? 'green' : tone === 'coral' ? 'alert' : tone === 'ink' ? 'dark' : tone === 'blue' ? 'primary' : 'secondary'
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-ink',
  secondary: 'bg-surface text-ink',
  alert: 'bg-coral text-ink',
  yellow: 'bg-sun text-ink',
  green: 'bg-mint text-ink',
  dark: 'bg-ink text-surface',
}

const SIZE = {
  sm: 'h-9 px-3 text-[13px] gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-13 px-5 text-[15px] gap-2',
}

export function BrutalistButton({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: keyof typeof SIZE
  icon?: LucideIcon
  iconRight?: LucideIcon
}) {
  return (
    <button
      type={type}
      className={cx(
        'press inline-flex shrink-0 items-center justify-center rounded-lg border-2 border-ink font-bold shadow-brut',
        'disabled:border-muted disabled:bg-line disabled:text-subtle disabled:shadow-none',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={size === 'sm' ? 16 : 18} strokeWidth={2} aria-hidden />}
      {children}
      {IconRight && <IconRight size={size === 'sm' ? 16 : 18} strokeWidth={2} aria-hidden />}
    </button>
  )
}

export function IconButton({
  label,
  icon: Icon,
  className,
  tone = 'white',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; tone?: Tone }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'press relative inline-flex size-10 shrink-0 items-center justify-center rounded-lg border-2 border-ink shadow-brut-sm',
        TONE_BG[tone],
        className,
      )}
      {...rest}
    >
      <Icon size={19} strokeWidth={2} aria-hidden />
      {children}
    </button>
  )
}

type BadgeVariant = 'neutral' | 'urgent' | 'dark' | 'blue' | 'green' | 'yellow' | 'muted'

const BADGE: Record<BadgeVariant, string> = {
  neutral: 'bg-surface text-ink',
  urgent: 'bg-coral text-ink',
  dark: 'bg-ink text-surface',
  blue: 'bg-brand text-ink',
  green: 'bg-mint text-ink',
  yellow: 'bg-sun text-ink',
  muted: 'bg-line text-ink',
}

export function Badge({
  variant = 'neutral',
  pulse,
  dot,
  mono,
  className,
  children,
}: {
  variant?: BadgeVariant
  pulse?: boolean
  dot?: boolean
  mono?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border-2 border-ink px-2 py-[3px] text-[11px] leading-none font-bold shadow-brut-sm',
        mono && 'font-mono tracking-wide uppercase',
        BADGE[variant],
        className,
      )}
    >
      {(dot || pulse) && (
        <span className="relative inline-flex size-2">
          {pulse && <span className="absolute inset-0 animate-ping rounded-full bg-surface opacity-90" />}
          <span
            className={cx(
              'relative inline-flex size-2 rounded-full border border-ink',
              variant === 'urgent' ? 'bg-surface' : variant === 'dark' ? 'bg-mint' : 'bg-leaf',
            )}
          />
        </span>
      )}
      {children}
    </span>
  )
}

export function IconTile({ icon: Icon, tone = 'white', size = 40 }: { icon: LucideIcon; tone?: Tone; size?: number }) {
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-xl border-2 border-ink', TONE_BG[tone])}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  )
}

export function MonoLabel({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cx('font-mono text-[10px] font-semibold tracking-[0.12em] uppercase', className)}>{children}</p>
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-2">
      <h2 className="text-[15px] font-bold">{children}</h2>
      {aside}
    </div>
  )
}

/** Selectable card used for radio-style choices (class, key, tier, format, mode). */
export function ChoiceCard({
  selected,
  onSelect,
  icon,
  title,
  description,
  aside,
  tone = 'yellow',
  className,
}: {
  selected: boolean
  onSelect: () => void
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  aside?: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cx(
        'press flex w-full items-center gap-3 rounded-xl border-2 border-ink p-3 text-left',
        selected ? cx(TONE_BG[tone], 'shadow-brut') : 'bg-surface shadow-brut-sm',
        className,
      )}
    >
      {icon && <IconTile icon={icon} size={36} tone={selected ? 'white' : 'canvas'} />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-bold">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-ink/75">{description}</span>}
      </span>
      {aside}
      <span
        className={cx(
          'flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-ink',
          selected ? 'bg-ink' : 'bg-surface',
        )}
        aria-hidden
      >
        {selected && <span className="size-2 rounded-full bg-surface" />}
      </span>
    </button>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-ink shadow-brut-sm transition-colors',
        checked ? 'bg-leaf' : 'bg-line',
      )}
    >
      <span
        className={cx(
          'absolute top-[2px] size-5 rounded-full border-2 border-ink bg-surface transition-[left] duration-150',
          checked ? 'left-[22px]' : 'left-[2px]',
        )}
      />
    </button>
  )
}

export function ProgressBar({ value, tone = 'green' }: { value: number; tone?: Tone }) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full border-2 border-ink bg-surface">
      <div className={cx('h-full', value > 0 && value < 100 && 'border-r-2 border-ink', TONE_BG[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}
