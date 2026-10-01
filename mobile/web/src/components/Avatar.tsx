import { defaultAvatar, patternDataUrl, type AvatarSpec } from '../lib/avatar'
import { initials } from '../lib/format'
import { cx } from './ui'

/** The teacher's picture: uploaded photo, generated pattern, or initials on a colour. */
export function Avatar({ name, spec, size = 40, className }: { name: string; spec?: AvatarSpec | null; size?: number; className?: string }) {
  const avatar = spec ?? defaultAvatar(name)
  const box = { width: size, height: size }
  const ring = cx('shrink-0 rounded-full border-2 border-ink', className)
  if (avatar.style === 'photo' && avatar.photo) return <img src={avatar.photo} alt="" style={box} className={cx(ring, 'object-cover')} />
  if (avatar.style === 'pattern') return <img src={patternDataUrl(name, avatar.color, avatar.pattern)} alt="" style={box} className={ring} />
  return (
    <span
      aria-hidden
      style={{ ...box, background: avatar.color, fontSize: Math.round(size * 0.36) }}
      className={cx(ring, 'flex items-center justify-center font-extrabold text-[#1a1a1a]')}
    >
      {initials(name) || 'T'}
    </span>
  )
}
