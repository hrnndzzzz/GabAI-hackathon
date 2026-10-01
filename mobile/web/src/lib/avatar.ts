// Profile pictures: initials or a generated block pattern on a chosen colour, or an uploaded photo.

export type PatternId = 'blocks' | 'dots' | 'stripes' | 'waves' | 'triangles' | 'rings' | 'checks' | 'stars'

export const PATTERNS: { id: PatternId; label: string }[] = [
  { id: 'blocks', label: 'Blocks' },
  { id: 'dots', label: 'Dots' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'waves', label: 'Waves' },
  { id: 'triangles', label: 'Triangles' },
  { id: 'rings', label: 'Rings' },
  { id: 'checks', label: 'Checks' },
  { id: 'stars', label: 'Sparkles' },
]

export interface AvatarSpec {
  style: 'initials' | 'pattern' | 'photo'
  /** Which generated pattern, when style is pattern (older pictures default to blocks). */
  pattern?: PatternId
  color: string
  /** Square JPEG data URL when style is photo. */
  photo: string | null
}

export const AVATAR_COLORS = ['#FFD93D', '#6BCB77', '#4D96FF', '#FF5964', '#B794F6', '#FF9F43', '#5CE1E6', '#F2F1EC']

export function defaultAvatar(name: string): AvatarSpec {
  return { style: 'initials', color: AVATAR_COLORS[hash(name) % 6], photo: null }
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A generated picture on the chosen colour. Each pattern varies with the name, so two teachers differ. */
export function patternDataUrl(seed: string, color: string, pattern: PatternId = 'blocks'): string {
  let h = hash(seed || 'GabAI')
  const next = () => (h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0)
  const ink = '#1a1a1a'
  let art = ''
  switch (pattern) {
    case 'dots': {
      const r = 4 + (next() % 3)
      for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) art += `<circle cx="${18 + x * 16 + (y % 2) * 8}" cy="${18 + y * 16}" r="${r}"/>`
      break
    }
    case 'stripes': {
      const w = 6 + (next() % 5)
      for (let i = -100; i < 200; i += w * 2) art += `<path d="M${i} 0 l100 100 h${w} l-100 -100z"/>`
      break
    }
    case 'waves': {
      const amp = 5 + (next() % 5)
      for (let y = 14; y < 100; y += 18) art += `<path d="M0 ${y} q12.5 -${amp} 25 0 t25 0 t25 0 t25 0" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`
      break
    }
    case 'triangles': {
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 5; x++) if (next() % 3) art += `<path d="M${x * 20} ${y * 20 + 20} l10 -18 l10 18z"/>`
      break
    }
    case 'rings': {
      const cx = 30 + (next() % 40)
      const cy = 30 + (next() % 40)
      for (let r = 8; r < 90; r += 12) art += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ink}" stroke-width="4"/>`
      break
    }
    case 'checks': {
      const s = 12 + (next() % 3) * 2
      for (let y = 0; y * s < 100; y++) for (let x = 0; x * s < 100; x++) if ((x + y) % 2) art += `<rect x="${x * s}" y="${y * s}" width="${s}" height="${s}"/>`
      break
    }
    case 'stars': {
      for (let i = 0; i < 7; i++) {
        const x = 12 + (next() % 76)
        const y = 12 + (next() % 76)
        const r = 5 + (next() % 8)
        art += `<path d="M${x} ${y - r}q${r * 0.15} ${r * 0.85} ${r} ${r}q-${r * 0.85} ${r * 0.15} -${r} ${r}q-${r * 0.15} -${r * 0.85} -${r} -${r}q${r * 0.85} -${r * 0.15} ${r} -${r}z"/>`
      }
      break
    }
    default: {
      // A symmetric 5×5 grid, like an identicon.
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 3; x++) {
          if (next() % 2 === 0) continue
          for (const col of x === 2 ? [2] : [x, 4 - x]) art += `<rect x="${20 + col * 12}" y="${20 + y * 12}" width="12" height="12"/>`
        }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color}"/><g fill="${ink}">${art}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Centre-crop a picked photo to a small square so it can live in local storage. */
export function squarePhoto(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      canvas
        .getContext('2d')!
        .drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be opened as an image'))
    }
    img.src = url
  })
}
