// A deliberately tiny Markdown subset for draft sections: paragraphs, "- "/"* "
// bullets, "1. " numbered items with indented continuation lines, "> " notes,
// "#" headings (shown bold), **bold** and *italic*. Output is never raw HTML.

export interface ListItem {
  text: string
  sub: string[]
}

export type Block =
  | { type: 'p'; text: string }
  | { type: 'note'; text: string }
  | { type: 'ul' | 'ol'; items: ListItem[] }

export function parseBlocks(md: string): Block[] {
  const blocks: Block[] = []
  let list: Extract<Block, { items: ListItem[] }> | null = null
  for (const raw of md.split('\n')) {
    if (!raw.trim()) {
      list = null
      continue
    }
    const heading = raw.match(/^#{1,6}\s+(.*)$/)
    const bullet = raw.match(/^[-*] (.*)$/)
    const numbered = raw.match(/^\d+\.\s+(.*)$/)
    const continuation = raw.match(/^\s{2,}(\S.*)$/)
    const note = raw.match(/^>\s?(.*)$/)
    if (heading) {
      list = null
      blocks.push({ type: 'p', text: `**${heading[1].replace(/\*\*/g, '')}**` })
    } else if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol'
      if (!list || list.type !== type) {
        list = { type, items: [] }
        blocks.push(list)
      }
      list.items.push({ text: (bullet ?? numbered)![1], sub: [] })
    } else if (continuation && list) {
      list.items[list.items.length - 1].sub.push(continuation[1])
    } else if (note) {
      list = null
      blocks.push({ type: 'note', text: note[1] })
    } else {
      list = null
      blocks.push({ type: 'p', text: raw.trim() })
    }
  }
  return blocks
}

export type InlineToken = { kind: 'text' | 'bold' | 'italic'; value: string }

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) tokens.push({ kind: 'text', value: text.slice(last, m.index) })
    tokens.push(m[1] !== undefined ? { kind: 'bold', value: m[1] } : { kind: 'italic', value: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) })
  return tokens
}

export function stripInline(text: string): string {
  return parseInline(text)
    .map((t) => t.value)
    .join('')
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineHtml(text: string): string {
  return parseInline(text)
    .map((t) => (t.kind === 'bold' ? `<strong>${esc(t.value)}</strong>` : t.kind === 'italic' ? `<em>${esc(t.value)}</em>` : esc(t.value)))
    .join('')
}

export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'p') return `<p>${inlineHtml(b.text)}</p>`
      if (b.type === 'note') return `<p class="note">${inlineHtml(b.text)}</p>`
      const items = b.items
        .map((i) => `<li>${inlineHtml(i.text)}${i.sub.map((s) => `<div class="sub">${inlineHtml(s)}</div>`).join('')}</li>`)
        .join('')
      return `<${b.type}>${items}</${b.type}>`
    })
    .join('')
}
