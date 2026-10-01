import type { PreviewFile } from '../store'
import { draftToCsv, draftToHtml, draftToMarkdown, slugify, type Draft, type ExportFormat } from './lessons'

// Generated files open in the in-app preview first; sharing or printing is a separate tap.

export function draftFile(draft: Draft, format: ExportFormat = draft.format): PreviewFile {
  const name = slugify(draft.title)
  if (format === 'pdf') return { title: draft.title, fileName: `${name}.pdf`, mime: 'application/pdf', kind: 'html', content: draftToHtml(draft) }
  if (format === 'markdown') return { title: draft.title, fileName: `${name}.md`, mime: 'text/markdown', kind: 'markdown', content: draftToMarkdown(draft) }
  return { title: draft.title, fileName: `${name}.csv`, mime: 'text/csv', kind: 'csv', content: draftToCsv(draft) }
}

export function csvFile(title: string, fileName: string, content: string): PreviewFile {
  return { title, fileName, mime: 'text/csv', kind: 'csv', content }
}
