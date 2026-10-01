import { ArrowLeft, FileText, Printer, Share2 } from 'lucide-react'
import { useBackHandler } from '../lib/back'
import { parseCsv } from '../lib/csv'
import { printHtml, shareTextFile } from '../lib/native'
import { useStore } from '../store'
import { Markdown } from './Markdown'
import { BrutalistButton, IconButton, MonoLabel } from './ui'

const KIND_LABEL = { html: 'PDF handout', markdown: 'Markdown', csv: 'Spreadsheet (CSV)' }

/** Full-screen viewer for generated files; sharing or printing is a second, explicit step. */
export function FilePreview() {
  const file = useStore((s) => s.preview)
  const close = useStore((s) => s.closePreview)
  const showToast = useStore((s) => s.showToast)
  useBackHandler(!!file, close)
  if (!file) return null
  const rows = file.kind === 'csv' ? parseCsv(file.content) : []

  return (
    <div className="absolute inset-0 z-50 flex animate-screen-in flex-col bg-canvas">
      <header className="flex shrink-0 items-center gap-3 border-b-2 border-ink px-4 pt-3 pb-3">
        <IconButton label="Close preview" icon={ArrowLeft} onClick={close} />
        <div className="min-w-0 flex-1">
          <MonoLabel className="text-subtle">Preview • {KIND_LABEL[file.kind]}</MonoLabel>
          <h1 className="truncate text-[16px] leading-tight font-extrabold">{file.title}</h1>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-3">
        {file.kind === 'html' && (
          <iframe
            title={file.title}
            srcDoc={file.content}
            sandbox=""
            className="h-full min-h-[480px] w-full rounded-xl border-2 border-ink bg-white"
          />
        )}
        {file.kind === 'markdown' && (
          <div className="rounded-xl border-2 border-ink bg-surface p-4">
            <Markdown source={file.content} />
          </div>
        )}
        {file.kind === 'csv' &&
          (rows.length ? (
            <div className="overflow-auto rounded-xl border-2 border-ink bg-surface">
              <table className="w-full text-left text-[12.5px]">
                <thead className="sticky top-0 bg-sun">
                  <tr>
                    {rows[0].map((h, i) => (
                      <th key={i} className="border-b-2 border-ink px-2.5 py-2 font-mono text-[10.5px] font-bold whitespace-nowrap uppercase">
                        {h.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1).map((r, i) => (
                    <tr key={i} className="border-b border-line last:border-0">
                      {r.map((c, j) => (
                        <td key={j} className="px-2.5 py-1.5 align-top whitespace-nowrap">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-subtle">This file has no rows.</p>
          ))}
      </main>
      <footer className="flex shrink-0 items-center gap-3 border-t-2 border-ink px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <MonoLabel className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-subtle">
          <FileText size={13} aria-hidden /> {file.fileName}
        </MonoLabel>
        {file.kind === 'html' ? (
          <BrutalistButton
            variant="yellow"
            icon={Printer}
            onClick={() => {
              printHtml(file.title, file.content)
              showToast('Opening the print dialog. Choose “Save as PDF”.')
            }}
          >
            Save as PDF
          </BrutalistButton>
        ) : (
          <BrutalistButton
            variant="yellow"
            icon={Share2}
            onClick={() => {
              shareTextFile(file.fileName, file.mime, file.content)
              showToast(`Shared ${file.fileName}`)
            }}
          >
            Share file
          </BrutalistButton>
        )}
      </footer>
    </div>
  )
}
