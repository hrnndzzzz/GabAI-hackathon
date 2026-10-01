// Turning a pasted class list into student names. Teachers copy from Excel, Google Sheets, a
// school portal or a document, so the text may be one name per line, tab-separated columns
// (row number, last name, first name, LRN…), a header row, or "LAST, FIRST" names.

const HEADER = /^(no\.?|#|num(ber)?|names?|students?|learners?|full ?name|last ?name|surname|first ?name|given ?name|middle ?name|m\.?i\.?|lrn|id|sex|gender)$/i
const LAST = /^(last ?name|surname|family ?name|apelyido)$/i
const FIRST = /^(first ?name|given ?name|pangalan)$/i
const MIDDLE = /^(middle ?(name|initial)|m\.?i\.?)$/i
const WHOLE = /^(full ?name|names?|students?( names?)?|learners?( names?)?|pangalan ng mag-aaral)$/i

/** Cells that are not part of a name: row numbers, IDs/LRNs, sex, blanks. */
function isNoise(cell: string): boolean {
  return !cell || /^[\d\s.#-]+$/.test(cell) || /^(m|f|male|female)$/i.test(cell)
}

function tidy(name: string): string {
  return name.replace(/\s+/g, ' ').replace(/^[\s,;.-]+|[\s,;]+$/g, '').trim()
}

export function parseRoster(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return []

  // Spreadsheet rows come tab-separated; CSV exports use commas or semicolons between columns.
  const tabbed = lines.some((l) => l.includes('\t'))
  const csv = !tabbed && lines.length > 1 && lines.every((l) => (l.match(/[,;]/g) ?? []).length >= 2)
  const split = (l: string) => (tabbed ? l.split('\t') : csv ? l.split(/[,;]/) : [l]).map((c) => c.trim().replace(/^"|"$/g, ''))
  const rows = lines.map(split)

  // A header row tells us which columns hold the last, first and middle names.
  let last = -1
  let first = -1
  let middle = -1
  let whole = -1
  if (rows[0].some((c) => HEADER.test(c))) {
    const header = rows.shift()!
    last = header.findIndex((c) => LAST.test(c))
    first = header.findIndex((c) => FIRST.test(c))
    middle = header.findIndex((c) => MIDDLE.test(c))
    whole = header.findIndex((c) => WHOLE.test(c))
  }

  const names = rows.map((cells) => {
    if (whole >= 0 && (first < 0 || last < 0)) return tidy(cells[whole] ?? '')
    if (first >= 0 && last >= 0) {
      const mid = middle >= 0 && cells[middle] ? ` ${cells[middle].replace(/\.?$/, '.')}` : ''
      return tidy(`${cells[first] ?? ''}${mid} ${cells[last] ?? ''}`)
    }
    // No usable header: keep the cells that look like name parts, in their original order.
    return tidy(cells.filter((c) => !isNoise(c)).join(' '))
  })

  const seen = new Set<string>()
  return names.filter((n) => {
    const key = n.toLowerCase()
    if (!n || isNoise(n) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
