import { ClipboardPaste, Trash2 } from 'lucide-react'
import { useEffect, useState, type ClipboardEvent } from 'react'
import { classLabel, levelTone, sortClasses, type TeacherClass } from '../lib/classes'
import { LEVELS, LEVEL_ORDER, gradeLabel, subjectsFor, type Level } from '../lib/levels'
import { readClipboardText } from '../lib/native'
import { parseRoster } from '../lib/roster'
import { newId } from '../lib/workspace'
import { Select, type SelectOption } from './Select'
import { Sheet } from './Sheet'
import { BrutalistButton, MonoLabel, TONE_BG, accentVariant, cx } from './ui'

const ADD = '__add__'

/** Level → grade → section dropdowns over the teacher's own classes, colour-coded by level. */
export function ClassPicker({
  classes,
  value,
  onChange,
  onAddSection,
}: {
  classes: TeacherClass[]
  value: string | null
  onChange: (classId: string | null) => void
  onAddSection?: (defaults: { level: Level; grade: number }) => void
}) {
  const selected = classes.find((c) => c.id === value)
  const firstLevel = LEVEL_ORDER.find((l) => classes.some((c) => c.level === l)) ?? 'highschool'
  const [level, setLevel] = useState<Level>(selected?.level ?? firstLevel)
  const [grade, setGrade] = useState<number>(selected?.grade ?? (classes.find((c) => c.level === level)?.grade ?? LEVELS[level].stops[0].value))

  useEffect(() => {
    if (selected) {
      setLevel(selected.level)
      setGrade(selected.grade)
    }
  }, [selected])

  const inLevel = classes.filter((c) => c.level === level)
  const grades = [...new Set(inLevel.map((c) => c.grade))].sort((a, b) => a - b)
  const sections = sortClasses(inLevel.filter((c) => c.grade === grade))

  function pickLevel(next: Level) {
    setLevel(next)
    const g = classes.filter((c) => c.level === next).map((c) => c.grade).sort((a, b) => a - b)[0] ?? LEVELS[next].stops[0].value
    setGrade(g)
    onChange(sortClasses(classes.filter((c) => c.level === next && c.grade === g))[0]?.id ?? null)
  }

  function pickGrade(next: number) {
    setGrade(next)
    onChange(sortClasses(classes.filter((c) => c.level === level && c.grade === next))[0]?.id ?? null)
  }

  const levelOptions: SelectOption<Level>[] = LEVEL_ORDER.map((l) => {
    const n = classes.filter((c) => c.level === l).length
    return { value: l, label: LEVELS[l].label, hint: n ? `${n} ${n === 1 ? 'section' : 'sections'}` : 'No sections yet', tone: levelTone(l) }
  })
  const gradeValues = grades.length ? grades : LEVELS[level].stops.map((s) => s.value)
  const gradeOptions: SelectOption<string>[] = gradeValues.map((g) => {
    const n = inLevel.filter((c) => c.grade === g).length
    return { value: String(g), label: gradeLabel(level, g), hint: n ? `${n} ${n === 1 ? 'section' : 'sections'}` : undefined, tone: levelTone(level) }
  })
  const sectionOptions: SelectOption<string>[] = [
    ...sections.map((c) => ({ value: c.id, label: c.section, hint: `${c.subject} • ${c.students.length} students`, tone: levelTone(level) })),
    ...(onAddSection ? [{ value: ADD, label: '+ Add a section', hint: `New ${gradeLabel(level, grade)} section` }] : []),
  ]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Select label="Level" value={level} options={levelOptions} onChange={pickLevel} tone={levelTone(level)} />
        <Select label={level === 'college' ? 'Year' : 'Grade'} value={String(grade)} options={gradeOptions} onChange={(g) => pickGrade(Number(g))} tone={levelTone(level)} />
      </div>
      <Select
        label="Section"
        value={selected && selected.level === level && selected.grade === grade ? selected.id : null}
        options={sectionOptions}
        placeholder={sections.length ? 'Choose a section' : 'No section yet'}
        onChange={(v) => (v === ADD ? onAddSection?.({ level, grade }) : onChange(v))}
        tone={levelTone(level)}
      />
    </div>
  )
}

/** Create or edit a section: level, grade, name, subject and roster. */
export function ClassSheet({
  initial,
  defaults,
  onSave,
  onDelete,
  onClose,
}: {
  initial?: TeacherClass
  defaults?: { level: Level; grade: number }
  onSave: (c: TeacherClass) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const [level, setLevel] = useState<Level>(initial?.level ?? defaults?.level ?? 'highschool')
  const [grade, setGrade] = useState(initial?.grade ?? defaults?.grade ?? 9)
  const [section, setSection] = useState(initial?.section ?? '')
  const [subject, setSubject] = useState(initial?.subject ?? subjectsFor(level, grade)[0])
  const [students, setStudents] = useState((initial?.students ?? []).join('\n'))
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  const subjects = subjectsFor(level, grade)
  const roster = students
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const draft = { level, grade, section, subject }
  const valid = section.trim().length > 0 && subject.trim().length > 0

  /** Adds pasted names (one per line, or spreadsheet rows) after the ones already typed. */
  function addPasted(text: string) {
    const names = parseRoster(text)
    if (!names.length) {
      setPasteNote('No names found in what you pasted.')
      return
    }
    const existing = new Set(roster.map((n) => n.toLowerCase()))
    const fresh = names.filter((n) => !existing.has(n.toLowerCase()))
    setStudents([...roster, ...fresh].join('\n'))
    setPasteNote(`Added ${fresh.length} ${fresh.length === 1 ? 'student' : 'students'}${names.length > fresh.length ? ` (${names.length - fresh.length} already listed)` : ''}.`)
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData('text')
    // A single name pastes normally; lists and spreadsheet rows are tidied into one name per line.
    if (!/[\n\t]/.test(text.trim())) return
    e.preventDefault()
    addPasted(text)
  }

  async function pasteFromClipboard() {
    const text = await readClipboardText()
    if (text?.trim()) addPasted(text)
    else setPasteNote('The clipboard is empty. Copy the names in your spreadsheet first.')
  }

  function changeLevel(next: Level) {
    setLevel(next)
    const g = LEVELS[next].stops.some((s) => s.value === grade) ? grade : LEVELS[next].stops[0].value
    setGrade(g)
    if (!subjectsFor(next, g).includes(subject)) setSubject(subjectsFor(next, g)[0])
  }

  return (
    <Sheet
      title={initial ? 'Edit section' : 'Add a section'}
      subtitle={valid ? classLabel(draft) : 'Level, grade, section and subject'}
      onClose={onClose}
      footer={
        <div className={cx('grid gap-2.5', onDelete ? 'grid-cols-[auto_1fr]' : 'grid-cols-1')}>
          {onDelete && (
            <BrutalistButton variant="secondary" icon={Trash2} aria-label="Remove section" onClick={onDelete}>
              Remove
            </BrutalistButton>
          )}
          <BrutalistButton
            variant={accentVariant(levelTone(level))}
            disabled={!valid}
            onClick={() => onSave({ id: initial?.id ?? newId(), level, grade, section: section.trim(), subject: subject.trim(), students: [...new Set(roster)] })}
          >
            {section.trim() ? 'Save section' : 'Name the section to save'}
          </BrutalistButton>
        </div>
      }
    >
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Level" className="grid grid-cols-3 gap-2">
          {LEVEL_ORDER.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={l === level}
              onClick={() => changeLevel(l)}
              className={cx(
                'press rounded-lg border-2 border-ink px-2 py-2 text-[12.5px] font-extrabold shadow-brut-sm',
                l === level ? TONE_BG[levelTone(l)] : 'bg-surface',
              )}
            >
              {LEVELS[l].label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select
            label={level === 'college' ? 'Year' : 'Grade'}
            value={String(grade)}
            tone={levelTone(level)}
            options={LEVELS[level].stops.map((s) => ({ value: String(s.value), label: gradeLabel(level, s.value), tone: levelTone(level) }))}
            onChange={(g) => {
              setGrade(Number(g))
              if (!subjectsFor(level, Number(g)).includes(subject)) setSubject(subjectsFor(level, Number(g))[0])
            }}
          />
          <Select
            label="Subject"
            value={subjects.includes(subject) ? subject : null}
            placeholder={subject || 'Choose'}
            options={subjects.map((s) => ({ value: s, label: s }))}
            onChange={setSubject}
          />
        </div>
        <label className="block">
          <span className="mb-1 block text-[13px] font-bold">Section name</span>
          <input
            value={section}
            onChange={(e) => setSection(e.target.value)}
            maxLength={40}
            placeholder={level === 'college' ? 'e.g. BSEd 1-A' : 'e.g. Sampaguita'}
            className="h-11 w-full rounded-lg border-2 border-ink bg-surface px-3 text-[15px] font-semibold outline-none focus:shadow-brut"
          />
        </label>
        <label className="block">
          <span className="mb-1 flex items-end justify-between">
            <span className="text-[13px] font-bold">Students</span>
            <MonoLabel className="text-subtle">{roster.length} • one per line</MonoLabel>
          </span>
          <textarea
            value={students}
            onPaste={onPaste}
            onChange={(e) => {
              setStudents(e.target.value)
              setPasteNote(null)
            }}
            rows={5}
            placeholder={'Juan dela Cruz\nMaria Santos'}
            className="w-full resize-none rounded-lg border-2 border-ink bg-surface p-2.5 text-[13.5px] leading-relaxed outline-none [field-sizing:content] focus:shadow-brut"
          />
        </label>
        <BrutalistButton size="sm" variant="secondary" icon={ClipboardPaste} className="w-full" onClick={() => void pasteFromClipboard()}>
          Paste list from spreadsheet
        </BrutalistButton>
        <p className={cx('text-xs', pasteNote ? 'font-semibold' : 'text-subtle')} role="status">
          {pasteNote ?? 'Copy the name column (or whole rows) in Excel or Google Sheets, then tap Paste. Row numbers, LRNs and headers are skipped.'}
        </p>
      </div>
    </Sheet>
  )
}
