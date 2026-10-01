// Profile pictures: initials or a generated block pattern on a chosen colour, or an uploaded photo.

export interface AvatarSpec {
  style: 'initials' | 'pattern' | 'photo'
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

/** A symmetric 5×5 block pattern derived from the name, like an identicon. */
export function patternDataUrl(seed: string, color: string): string {
  let h = hash(seed || 'GabAI')
  const cells: string[] = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
      if (h % 2 === 0) continue
      for (const cx of x === 2 ? [2] : [x, 4 - x]) cells.push(`<rect x="${20 + cx * 12}" y="${20 + y * 12}" width="12" height="12"/>`)
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${color}"/><g fill="#1a1a1a">${cells.join('')}</g></svg>`
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
