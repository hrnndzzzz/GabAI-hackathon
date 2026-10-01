import { BadgeCheck, Check, ChevronDown, Download, Languages, ListPlus, LoaderCircle, Lock, Pencil, Printer, Save, WandSparkles, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { FlowFooter, FlowHeader } from '../components/FlowHeader'
import { Markdown } from '../components/Markdown'
import { Badge, BrutalistButton, BrutalistCard, MonoLabel, TONE_BG, accentVariant, cx, type Tone } from '../components/ui'
import { FORMATS, TIERS, draftToCsv, draftToHtml, draftToMarkdown, slugify, type Draft, type DraftSection, type Refinement } from '../lib/lessons'
import { LEVELS, gradeLabel, levelOf } from '../lib/levels'
import { modeLabel } from '../lib/materials'
import { printHtml, shareTextFile } from '../lib/native'
import { useStore, useWorkspace } from '../store'

const REFINEMENTS: { id: Refinement; label: string; icon: LucideIcon; done: string }[] = [
  { id: 'review', label: '+ Add 3 review questions', icon: ListPlus, done: 'Added 3 review questions' },
  { id: 'simplify', label: 'Simplify vocabulary', icon: WandSparkles, done: 'Vocabulary simplified across all sections' },
  { id: 'bilingual', label: 'Translate to Tagalog/Bilingual', icon: Languages, done: 'Added Filipino translations to each section' },
]

export function AiDraft() {
  const draft = useStore((s) => s.draft) as Draft
  const setDraft = useStore((s) => s.setDraft)
  const saveModule = useStore((s) => s.saveModule)
  const markReviewed = useStore((s) => s.markReviewed)
  const refineDraft = useStore((s) => s.refine)
  const ws = useWorkspace()
  const showToast = useStore((s) => s.showToast)
  const [open, setOpen] = useState<string[]>(() => (draft.sections[0] ? [draft.sections[0].id] : []))
  const [busy, setBusy] = useState<Refinement | 'save' | 'review' | null>(null)

  const online = draft.origin === 'gemini'
  const saved = ws.modules.find((m) => m.id === draft.id)
  const isSaved = online ? !draft.dirty : saved?.draft === draft
  const format = FORMATS[draft.format]
  const reviewed = draft.material?.status === 'reviewed'
  const tone = LEVELS[levelOf(draft)].tone

  function update(next: Draft) {
    setDraft(online ? { ...next, dirty: true } : next)
  }

  function updateSection(id: string, patch: Partial<DraftSection>) {
    update({ ...draft, sections: draft.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }

  async function run(kind: Refinement | 'save' | 'review', action: () => Promise<void>, done: string) {
    if (busy) return
    setBusy(kind)
    try {
      await action()
      showToast(done)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  function refine(r: (typeof REFINEMENTS)[number]) {
    if (draft.refinements.includes(r.id)) return
    void run(r.id, async () => {
      await refineDraft(r.id)
      if (r.id === 'review') setOpen((o) => [...o, 'review', ...(useStore.getState().draft?.sections.map((s) => s.id) ?? [])])
    }, online ? `${r.done}. Save to keep it on the server.` : r.done)
  }

  function exportDraft() {
    const name = slugify(draft.title)
    if (draft.format === 'pdf') {
      printHtml(draft.title, draftToHtml(draft))
      showToast('Opening the print dialog. Choose “Save as PDF”.')
    } else if (draft.format === 'markdown') {
      shareTextFile(`${name}.md`, 'text/markdown', draftToMarkdown(draft))
      showToast(`Exported ${name}.md`)
    } else {
      shareTextFile(`${name}.csv`, 'text/csv', draftToCsv(draft))
      showToast(`Exported ${name}.csv for LMS import`)
    }
  }

  const provenance = draft.material?.provenance
  return (
    <div className="flex h-full flex-col">
      <FlowHeader step={3} total={3} label="Draft & refine" title="Review your draft" tone={tone} />
      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <BrutalistCard color={tone} className="p-3">
          <label htmlFor="draft-title" className="block">
            <MonoLabel className="text-ink/80">
              {modeLabel(draft)} • {online ? `${reviewed ? 'Reviewed' : 'AI draft'} • rev ${draft.material?.revision}` : 'Demo template draft'}
            </MonoLabel>
          </label>
          <input
            id="draft-title"
            value={draft.title}
            maxLength={200}
            onChange={(e) => update({ ...draft, title: e.target.value })}
            className="mt-1.5 w-full rounded-lg border-2 border-ink bg-white px-2.5 py-2 text-[15px] leading-snug font-extrabold outline-none focus:shadow-brut"
          />
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Badge mono>{gradeLabel(levelOf(draft), draft.grade)}</Badge>
            <Badge mono>{TIERS[draft.tier].label}</Badge>
            {!online && <Badge mono>{draft.minutes} min</Badge>}
            <Badge mono variant="dark">
              {format.label}
            </Badge>
          </div>
          {provenance && (
            <p className="mt-2 text-[11.5px] leading-snug text-ink/80">
              Generated by {provenance.model ?? 'Gemini'} on {new Date(provenance.generated_at).toLocaleDateString()}. Check facts before
              using it in class; it is a draft until you mark it reviewed.
            </p>
          )}
        </BrutalistCard>

        {draft.sections.map((section, i) => (
          <SectionCard
            key={section.id}
            index={i}
            tone={tone}
            section={section}
            open={open.includes(section.id)}
            onToggle={() => setOpen((o) => (o.includes(section.id) ? o.filter((x) => x !== section.id) : [...o, section.id]))}
            onChange={(body) => updateSection(section.id, { body })}
          />
        ))}
      </main>
      <FlowFooter
        note={
          <div>
            <MonoLabel className="mb-1.5 text-subtle">Refine with GabAI{online ? ' • each is a new AI request' : ''}</MonoLabel>
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {REFINEMENTS.map((r) => {
                const applied = draft.refinements.includes(r.id)
                const Icon = busy === r.id ? LoaderCircle : applied ? Check : r.icon
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={applied || !!busy}
                    onClick={() => refine(r)}
                    className={cx(
                      'press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border-2 border-ink px-2.5 text-xs font-bold whitespace-nowrap shadow-brut-sm',
                      applied ? cx(TONE_BG[tone], 'disabled:shadow-none') : 'bg-white disabled:opacity-60',
                    )}
                  >
                    <Icon size={14} strokeWidth={2.5} className={cx(busy === r.id && 'animate-spin')} aria-hidden />
                    {r.label}
                  </button>
                )
              })}
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {online && isSaved ? (
            <BrutalistButton
              variant="secondary"
              icon={busy === 'review' ? LoaderCircle : BadgeCheck}
              disabled={reviewed || !!busy}
              onClick={() => void run('review', markReviewed, 'Marked as reviewed')}
            >
              {reviewed ? 'Reviewed' : 'Mark reviewed'}
            </BrutalistButton>
          ) : (
            <BrutalistButton
              variant="secondary"
              icon={busy === 'save' ? LoaderCircle : isSaved ? Check : Save}
              disabled={isSaved || !!busy}
              onClick={() => void run('save', saveModule, online ? 'Saved • review status reset to draft' : saved ? 'Module updated' : 'Saved to AI Teaching Modules')}
            >
              {isSaved ? 'Saved' : online || saved ? 'Save changes' : 'Save module'}
            </BrutalistButton>
          )}
          <BrutalistButton variant={accentVariant(tone)} icon={draft.format === 'pdf' ? Printer : Download} onClick={exportDraft}>
            Export {draft.format === 'pdf' ? 'PDF' : draft.format === 'markdown' ? '.md' : 'CSV'}
          </BrutalistButton>
        </div>
      </FlowFooter>
    </div>
  )
}

function SectionCard({
  index,
  tone,
  section,
  open,
  onToggle,
  onChange,
}: {
  index: number
  tone: Tone
  section: DraftSection
  open: boolean
  onToggle: () => void
  onChange: (body: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const bodyId = `section-${section.id}`
  return (
    <BrutalistCard shadow="sm" className="overflow-hidden">
      <div className="flex items-center gap-2 pr-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-3 text-left"
        >
          <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-md border-2 border-ink font-mono text-[11px] font-bold', TONE_BG[tone])}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="min-w-0 flex-1 text-sm leading-tight font-bold">{section.title}</span>
          <ChevronDown size={18} strokeWidth={2.5} className={cx('shrink-0 transition-transform duration-300', open && 'rotate-180')} aria-hidden />
        </button>
        {section.readonly ? (
          <span className="flex h-8 shrink-0 items-center gap-1 px-1 font-mono text-[10px] font-bold text-subtle" title="Generated from structured data">
            <Lock size={12} aria-hidden /> DATA
          </span>
        ) : (
        <button
          type="button"
          aria-label={editing ? `Finish editing ${section.title}` : `Edit ${section.title}`}
          onClick={() => {
            if (!open) onToggle()
            setEditing((e) => !e)
          }}
          className={cx(
            'press flex h-8 shrink-0 items-center gap-1 rounded-md border-2 border-ink px-2 text-[11px] font-bold shadow-brut-sm',
            editing ? 'bg-ink text-white' : 'bg-white',
          )}
        >
          {editing ? <Check size={13} aria-hidden /> : <Pencil size={13} aria-hidden />}
          {editing ? 'Done' : 'Edit'}
        </button>
        )}
      </div>
      <div id={bodyId} className={cx('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <div className="border-t-2 border-ink px-3 py-3">
            {editing && !section.readonly ? (
              <textarea
                value={section.body}
                onChange={(e) => onChange(e.target.value)}
                aria-label={`${section.title} (Markdown)`}
                autoFocus
                className="min-h-40 w-full resize-none rounded-lg border-2 border-ink bg-canvas p-2.5 font-mono text-[12.5px] leading-relaxed outline-none [field-sizing:content] focus:shadow-brut"
              />
            ) : (
              <Markdown source={section.body} />
            )}
          </div>
        </div>
      </div>
    </BrutalistCard>
  )
}
