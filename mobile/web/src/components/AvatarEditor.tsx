import { Check, ImagePlus, Trash2 } from 'lucide-react'
import { AVATAR_COLORS, PATTERNS, patternDataUrl, squarePhoto, type AvatarSpec } from '../lib/avatar'
import { useStore } from '../store'
import { Avatar } from './Avatar'
import { usePhotoPicker } from './PhotoPicker'
import { BrutalistButton, MonoLabel, cx } from './ui'

const STYLES: { id: AvatarSpec['style']; label: string }[] = [
  { id: 'initials', label: 'Initials' },
  { id: 'pattern', label: 'Pattern' },
  { id: 'photo', label: 'Photo' },
]

/** Generated picture (initials or pattern) on a chosen colour, or an uploaded photo. */
export function AvatarEditor({ name, value, onChange }: { name: string; value: AvatarSpec; onChange: (v: AvatarSpec) => void }) {
  const showToast = useStore((s) => s.showToast)
  const picker = usePhotoPicker((file) => {
    squarePhoto(file)
      .then((photo) => onChange({ ...value, style: 'photo', photo }))
      .catch((e: Error) => showToast(e.message))
  })

  return (
    <div className="flex flex-col items-center gap-3">
      <Avatar name={name || 'Teacher'} spec={value} size={96} className="shadow-brut" />
      <div role="radiogroup" aria-label="Picture style" className="grid w-full grid-cols-3 gap-2">
        {STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={value.style === s.id}
            onClick={() => (s.id === 'photo' && !value.photo ? picker.pick() : onChange({ ...value, style: s.id }))}
            className={cx(
              'press h-9 rounded-lg border-2 border-ink text-[13px] font-bold shadow-brut-sm',
              value.style === s.id ? 'bg-ink text-surface' : 'bg-surface',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {value.style === 'pattern' && (
        <div className="w-full">
          <MonoLabel className="mb-1.5 text-subtle">Pattern</MonoLabel>
          <div role="radiogroup" aria-label="Pattern" className="grid grid-cols-4 gap-2">
            {PATTERNS.map((p) => {
              const on = (value.pattern ?? 'blocks') === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={p.label}
                  onClick={() => onChange({ ...value, pattern: p.id })}
                  className={cx('press flex flex-col items-center gap-1 rounded-lg border-2 border-ink p-1.5 shadow-brut-sm', on ? 'bg-ink text-surface' : 'bg-surface')}
                >
                  <img src={patternDataUrl(name || 'Teacher', value.color, p.id)} alt="" className="aspect-square w-full rounded-full border-2 border-ink" />
                  <span className="text-[10.5px] leading-none font-bold">{p.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {value.style !== 'photo' ? (
        <div className="w-full">
          <MonoLabel className="mb-1.5 text-subtle">Background colour</MonoLabel>
          <div role="radiogroup" aria-label="Background colour" className="grid grid-cols-8 gap-1.5">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={value.color === c}
                aria-label={`Colour ${c}`}
                onClick={() => onChange({ ...value, color: c })}
                style={{ background: c }}
                className="press flex aspect-square w-full items-center justify-center rounded-full border-2 border-ink text-[#1a1a1a] shadow-brut-sm"
              >
                {value.color === c && <Check size={16} strokeWidth={3} aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid w-full grid-cols-2 gap-2">
          <BrutalistButton size="sm" variant="secondary" icon={ImagePlus} onClick={picker.pick}>
            Change photo
          </BrutalistButton>
          <BrutalistButton size="sm" variant="secondary" icon={Trash2} onClick={() => onChange({ ...value, style: 'initials', photo: null })}>
            Remove photo
          </BrutalistButton>
        </div>
      )}
      {value.style !== 'photo' && (
        <BrutalistButton size="sm" variant="secondary" icon={ImagePlus} className="w-full" onClick={picker.pick}>
          Upload a photo instead
        </BrutalistButton>
      )}
      {picker.element}
    </div>
  )
}
