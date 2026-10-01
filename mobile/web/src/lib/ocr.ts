import type { Answer, ExtractionItem, KeyQuestion } from './scoring'

// Recognition helpers. Real recognition is the backend's online Gemini OCR; the
// demo workspace uses a deterministic stand-in so the offline demo still works.

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function seeded(seed: number) {
  let s = seed || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickDistinct(rng: () => number, from: number[], count: number): number[] {
  const pool = [...from]
  const out: number[] = []
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
  return out
}

/** What is physically marked on the (demo) paper for each question. */
export type PaperMarks = Record<number, string[]>

export interface DemoPaper {
  marks: PaperMarks
  items: ExtractionItem[]
}

/**
 * Simulated recognizer for the demo workspace. Deterministic per student and key,
 * and shaped exactly like the server's OCR draft (states, review flags, notes).
 */
export function demoRecognize(student: string, keyId: string, questions: KeyQuestion[]): DemoPaper {
  const rng = seeded(hash(`${student}|${keyId}`))
  const numbers = questions.map((q) => q.number)
  // Marcus Chen's first-paper is the reference demo: 23/25 with three hard-to-read marks.
  const reference = student === 'Marcus Chen' && numbers.length === 25
  const wrong = reference ? [12, 24] : pickDistinct(rng, numbers, 1 + Math.floor(rng() * 5))
  const ambiguous = reference ? [7, 18, 23] : pickDistinct(rng, numbers.filter((n) => !wrong.includes(n)), 1 + Math.floor(rng() * 3))
  const blank = !reference && rng() < 0.35 ? pickDistinct(rng, numbers.filter((n) => !wrong.includes(n) && !ambiguous.includes(n)), 1) : []

  const marks: PaperMarks = {}
  const items: ExtractionItem[] = []
  for (const q of questions) {
    const options = q.kind === 'true_false' ? ['TRUE', 'FALSE'] : (q.choices ?? [])
    const correct = q.correct_answer ?? options[0]
    let intended = correct
    if (wrong.includes(q.number)) {
      const others = options.filter((o) => o !== correct)
      intended = reference && q.number === 12 ? 'C' : others[Math.floor(rng() * others.length)]
    }
    const short = (v: string) => (q.kind === 'true_false' ? v[0] : v)
    if (blank.includes(q.number)) {
      marks[q.number] = []
      items.push({ number: q.number, value: null, state: 'blank_candidate', review_flags: ['No mark found'], notes: 'Answer area appears empty.' })
    } else if (ambiguous.includes(q.number)) {
      // Lookalike rival: B is confused with D, A with C; True with False.
      const rival =
        q.kind === 'true_false'
          ? intended === 'TRUE'
            ? 'FALSE'
            : 'TRUE'
          : options[(options.indexOf(intended) + 2) % options.length]
      marks[q.number] = [intended, rival]
      items.push({
        number: q.number,
        value: `${short(intended)} or ${short(rival)}`,
        state: 'ambiguous',
        review_flags: ['Two marks are shaded'],
        notes: `Competing marks for ${short(intended)} and ${short(rival)}; the ${short(rival)} mark looks partly erased.`,
      })
    } else {
      marks[q.number] = [intended]
      items.push({ number: q.number, value: short(intended), state: 'recognized', review_flags: [], notes: '' })
    }
  }
  return { marks, items }
}

/** Turn an OCR draft into unconfirmed answers. Recognition alone never confirms (docs/scoring.md). */
export function extractionToAnswers(items: ExtractionItem[]): Answer[] {
  return [...items]
    .sort((a, b) => a.number - b.number)
    .map((item) => ({
      number: item.number,
      state: item.state,
      value: item.state === 'blank_candidate' ? null : item.value,
      extracted: item,
    }))
}

/** Best-effort "Name: …" line from the OCR transcription, for the teacher to confirm. */
export function guessStudentName(text: string): string {
  const match = /^\s*(?:name|pangalan)\s*[:\-–]\s*(.{2,60})$/im.exec(text)
  return match ? match[1].replace(/\s{2,}.*/, '').trim() : ''
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Draws the answer sheet shown when no camera is available, from the same marks the
 * demo recognizer reports, so the sample paper and the parsed answers always agree.
 */
export function renderPaperSvg(opts: { student: string; classLabel: string; title: string; questions: KeyQuestion[]; marks: PaperMarks }): string {
  const { student, classLabel, title, questions, marks } = opts
  const W = 600
  const H = 848
  const hand = `'Bradley Hand','Segoe Print','Comic Sans MS',cursive`
  const mc = questions.filter((q) => q.kind === 'multiple_choice')
  const tf = questions.filter((q) => q.kind === 'true_false')
  const perCol = Math.max(1, Math.ceil(mc.length / 2))
  const rowH = Math.min(30, 330 / perCol)
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#fdfdfb"/>`]

  for (const [x, y] of [
    [22, 22],
    [W - 46, 22],
    [22, H - 46],
    [W - 46, H - 46],
  ]) {
    parts.push(`<rect x="${x}" y="${y}" width="24" height="24" fill="#1a1a1a"/>`)
  }
  parts.push(
    `<text x="300" y="78" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#1a1a1a">${esc(title.toUpperCase())}</text>`,
    `<text x="300" y="102" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#444">${esc(classLabel)} — ${questions.length} items</text>`,
    `<line x1="60" y1="120" x2="540" y2="120" stroke="#1a1a1a" stroke-width="2"/>`,
    `<text x="60" y="158" font-family="Arial,sans-serif" font-size="14" fill="#1a1a1a">Name:</text>`,
    `<line x1="108" y1="162" x2="370" y2="162" stroke="#888" stroke-width="1"/>`,
    `<text x="116" y="156" font-family="${hand}" font-size="24" fill="#1d3b8f">${esc(student)}</text>`,
    `<text x="390" y="158" font-family="Arial,sans-serif" font-size="14" fill="#1a1a1a">Score:</text>`,
    `<line x1="440" y1="162" x2="540" y2="162" stroke="#888" stroke-width="1"/>`,
  )

  const bubble = (cx: number, cy: number, label: string, number: number, value: string) => {
    const shaded = marks[number] ?? []
    const index = shaded.indexOf(value)
    // The first mark is the student's answer; a second, lighter mark makes it ambiguous.
    const fill = index === 0 ? '#1a1a1a' : index === 1 ? '#8a8a8a' : 'none'
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="11" fill="${fill}" stroke="#1a1a1a" stroke-width="1.4"/>`,
      `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="${index >= 0 ? '#fff' : '#1a1a1a'}">${label}</text>`,
    )
  }

  if (mc.length) {
    parts.push(
      `<text x="60" y="206" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#1a1a1a">PART I. MULTIPLE CHOICE — shade the letter of the best answer.</text>`,
    )
    mc.forEach((q, idx) => {
      const x = 70 + (idx < perCol ? 0 : 250)
      const y = 240 + (idx % perCol) * rowH
      parts.push(`<text x="${x}" y="${y + 5}" font-family="Arial,sans-serif" font-size="14" fill="#1a1a1a">${q.number}.</text>`)
      ;(q.choices ?? []).forEach((letter, li) => bubble(x + 44 + li * 36, y, letter, q.number, letter))
    })
  }

  if (tf.length) {
    const top = mc.length ? 240 + perCol * rowH + 30 : 206
    const tfPerCol = Math.ceil(tf.length / 2)
    parts.push(
      `<text x="60" y="${top}" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#1a1a1a">PART II. TRUE OR FALSE — shade T or F.</text>`,
    )
    tf.forEach((q, idx) => {
      const x = 70 + (idx < tfPerCol ? 0 : 250)
      const y = top + 34 + (idx % tfPerCol) * 30
      parts.push(`<text x="${x}" y="${y + 5}" font-family="Arial,sans-serif" font-size="14" fill="#1a1a1a">${q.number}.</text>`)
      bubble(x + 44, y, 'T', q.number, 'TRUE')
      bubble(x + 80, y, 'F', q.number, 'FALSE')
    })
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Rasterize any captured image (including the SVG sample) to a JPEG the OCR endpoint accepts. */
export function toJpegBlob(dataUrl: string, maxSide = 1600): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))), 'image/jpeg', 0.88)
    }
    img.onerror = () => reject(new Error('Could not read the captured image'))
    img.src = dataUrl
  })
}

/** Read a picked photo into a JPEG data URL, scaled down so it stays well under the upload limit. */
export function fileToDataUrl(file: File, maxSide = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
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
