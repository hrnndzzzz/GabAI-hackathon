import { ArrowRight, Backpack, BookOpen, CircleHelp, ClipboardCheck, GraduationCap, LifeBuoy, School, type LucideIcon } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { FlowFooter, FlowHeader, StepButtons } from '../components/FlowHeader'
import { useAiSteps } from '../components/flowSteps'
import { BrutalistButton, IconTile, MonoLabel, SectionTitle, TONE_BG, TONE_HEX, accentVariant, cx } from '../components/ui'
import { MODES, suggestedObjectives, type Mode } from '../lib/lessons'
import {
  LEVELS,
  LEVEL_ORDER,
  bandLabel,
  defaultGrade,
  gradeLabel,
  levelOf,
  subjectsFor,
  topicSuggestions,
  type Level,
} from '../lib/levels'
import { objectiveList } from '../lib/materials'
import { isConnected, useStore } from '../store'

export const MODE_ICONS: Record<Mode, LucideIcon> = {
  lesson: BookOpen,
  rubric: ClipboardCheck,
  remedial: LifeBuoy,
  quiz: CircleHelp,
}

const LEVEL_ICONS: Record<Level, LucideIcon> = { elementary: Backpack, highschool: School, college: GraduationCap }

export function AiParams() {
  const params = useStore((s) => s.aiParams)
  const setAiParams = useStore((s) => s.setAiParams)
  const navigate = useStore((s) => s.navigate)
  const back = useStore((s) => s.back)
  const steps = useAiSteps()
  const connected = useStore((s) => isConnected(s.session))
  const level = levelOf(params)
  const info = LEVELS[level]
  const tone = info.tone
  const stops = info.stops
  const index = Math.max(0, stops.findIndex((s) => s.value === params.grade))
  const subjects = subjectsFor(level, params.grade)
  const suggestions = topicSuggestions(level, params.grade, params.subject)
  const objectives = objectiveList(params.objectives)
  const [typingOther, setTypingOther] = useState(!subjects.includes(params.subject))
  const isOther = typingOther || !subjects.includes(params.subject)

  /** Moving to another level or grade band swaps the subject list and, if the topic was one of
   *  our suggestions (not something the teacher typed), the topic too. */
  function retarget(nextLevel: Level, nextGrade: number) {
    const nextSubjects = subjectsFor(nextLevel, nextGrade)
    const keepSubject = isOther || nextSubjects.includes(params.subject)
    const typedTopic = params.topic.trim() && !suggestions.some((s) => s.topic === params.topic)
    const ideas = topicSuggestions(nextLevel, nextGrade, params.subject)
    const idea = typedTopic ? undefined : keepSubject ? ideas.find((s) => s.subject === params.subject) : ideas[0]
    setAiParams({
      level: nextLevel,
      grade: nextGrade,
      subject: keepSubject ? params.subject : (idea?.subject ?? nextSubjects[0]),
      ...(idea ? { topic: idea.topic, objectives: suggestedObjectives(idea.topic) } : {}),
    })
  }

  return (
    <div className="flex h-full flex-col">
      <FlowHeader step={1} total={3} label="Lesson parameters" title="What are you teaching?" tone={tone} steps={steps} />
      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section>
          <SectionTitle>School level</SectionTitle>
          <div role="radiogroup" aria-label="School level" className="grid grid-cols-3 gap-2">
            {LEVEL_ORDER.map((id) => {
              const on = id === level
              const Icon = LEVEL_ICONS[id]
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => !on && retarget(id, defaultGrade(id))}
                  className={cx(
                    'press flex flex-col items-start gap-1.5 rounded-xl border-2 border-ink p-2.5 text-left',
                    on ? cx(TONE_BG[LEVELS[id].tone], 'shadow-brut') : 'bg-surface shadow-brut-sm',
                  )}
                >
                  <span className={cx('flex size-8 items-center justify-center rounded-lg border-2 border-ink', on ? 'bg-surface' : TONE_BG[LEVELS[id].tone])}>
                    <Icon size={17} aria-hidden />
                  </span>
                  <span className="text-[13px] leading-tight font-extrabold">{LEVELS[id].label}</span>
                  <span className="font-mono text-[9.5px] leading-tight font-semibold text-ink/75 uppercase">{LEVELS[id].range}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <SectionTitle aside={<span className="font-mono text-sm font-extrabold">{gradeLabel(level, params.grade)}</span>}>
            {level === 'college' ? 'Year level' : 'Grade level'}
          </SectionTitle>
          <div className="rounded-xl border-2 border-ink bg-surface px-4 pt-5 pb-3 shadow-brut-sm">
            <input
              type="range"
              min={0}
              max={stops.length - 1}
              step={1}
              value={index}
              onChange={(e) => retarget(level, stops[Number(e.target.value)].value)}
              aria-label={level === 'college' ? 'Year level' : 'Grade level'}
              aria-valuetext={gradeLabel(level, params.grade)}
              className="brut-range"
              style={{ '--fill': `${(index / (stops.length - 1)) * 100}%`, '--range-color': TONE_HEX[tone] } as CSSProperties}
            />
            <div className="relative mt-2 h-7">
              {stops.map((stop, i) => (
                <button
                  key={stop.value}
                  type="button"
                  tabIndex={-1}
                  onClick={() => retarget(level, stop.value)}
                  className={cx(
                    'absolute -translate-x-1/2 rounded-md border-2 px-1.5 py-0.5 font-mono text-xs font-bold',
                    i === index ? cx(TONE_BG[tone], 'border-ink') : 'border-transparent text-subtle',
                  )}
                  style={{ left: `calc(14px + (100% - 28px) * ${i / (stops.length - 1)})` }}
                >
                  {stop.tick}
                </button>
              ))}
            </div>
            <MonoLabel className="mt-1 text-center text-subtle">{bandLabel(level, params.grade)}</MonoLabel>
          </div>
        </section>

        <section>
          <SectionTitle aside={<MonoLabel className="text-subtle">For {gradeLabel(level, params.grade)}</MonoLabel>}>Subject</SectionTitle>
          <div role="radiogroup" aria-label="Subject" className="flex flex-wrap gap-2">
            {subjects.map((subject) => {
              const on = !isOther && params.subject === subject
              return (
                <button
                  key={subject}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setTypingOther(false)
                    setAiParams({ subject })
                  }}
                  className={cx(
                    'press h-9 rounded-lg border-2 border-ink px-3 text-[13px] font-bold shadow-brut-sm',
                    on ? cx(TONE_BG[tone], 'shadow-brut') : 'bg-surface',
                  )}
                >
                  {subject}
                </button>
              )
            })}
            <button
              type="button"
              role="radio"
              aria-checked={isOther}
              onClick={() => {
                setTypingOther(true)
                if (subjects.includes(params.subject)) setAiParams({ subject: '' })
              }}
              className={cx(
                'press h-9 rounded-lg border-2 border-dashed border-ink px-3 text-[13px] font-bold shadow-brut-sm',
                isOther ? TONE_BG[tone] : 'bg-surface',
              )}
            >
              Other…
            </button>
          </div>
          {isOther && (
            <input
              value={params.subject}
              onChange={(e) => setAiParams({ subject: e.target.value })}
              placeholder="Type the subject"
              maxLength={80}
              aria-label="Other subject"
              autoFocus
              className="mt-2 h-11 w-full rounded-lg border-2 border-ink bg-surface px-3 text-[15px] font-semibold outline-none focus:shadow-brut"
            />
          )}
        </section>

        <section>
          <label htmlFor="ai-topic" className="mb-2 block text-[15px] font-bold">
            Topic
          </label>
          <textarea
            id="ai-topic"
            rows={2}
            value={params.topic}
            onChange={(e) => setAiParams({ topic: e.target.value })}
            placeholder="What is the lesson about?"
            className="w-full resize-none rounded-xl border-2 border-ink bg-surface p-3 text-[15px] font-semibold shadow-brut-sm outline-none focus:shadow-brut"
          />
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.topic}
                  type="button"
                  onClick={() => {
                    setTypingOther(false)
                    setAiParams({ topic: s.topic, subject: s.subject, objectives: suggestedObjectives(s.topic) })
                  }}
                  className={cx(
                    'press rounded-lg border-2 border-ink px-2.5 py-1 text-xs font-bold shadow-brut-sm',
                    params.topic === s.topic ? TONE_BG[tone] : 'bg-surface',
                  )}
                >
                  {s.topic}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <label htmlFor="ai-objectives" className="mb-2 flex items-end justify-between">
            <span className="text-[15px] font-bold">Learning objectives</span>
            <MonoLabel className="text-subtle">One per line • {objectives.length}/20</MonoLabel>
          </label>
          <textarea
            id="ai-objectives"
            rows={3}
            value={params.objectives}
            onChange={(e) => setAiParams({ objectives: e.target.value })}
            placeholder="e.g. Describe the stages of the water cycle"
            className="w-full resize-none rounded-xl border-2 border-ink bg-surface p-3 text-[13.5px] leading-snug shadow-brut-sm outline-none [field-sizing:content] focus:shadow-brut"
          />
        </section>

        <section>
          <SectionTitle>Output mode</SectionTitle>
          <div role="radiogroup" aria-label="Output mode" className="grid grid-cols-2 gap-2.5">
            {(Object.keys(MODES) as Mode[]).map((mode) => {
              const on = params.mode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setAiParams({ mode })}
                  className={cx(
                    'press flex flex-col items-start gap-2 rounded-xl border-2 border-ink p-3 text-left',
                    on ? cx(TONE_BG[tone], 'shadow-brut') : 'bg-surface shadow-brut-sm',
                  )}
                >
                  <IconTile icon={MODE_ICONS[mode]} size={34} tone={on ? 'white' : 'canvas'} />
                  <span className="text-sm leading-tight font-bold">{MODES[mode].label}</span>
                  <span className="text-[11.5px] leading-snug text-ink/75">{MODES[mode].description}</span>
                </button>
              )
            })}
          </div>
        </section>
        <MonoLabel className="text-center text-subtle">
          {connected ? 'Drafted online by Gemini • no student data is sent' : 'Demo templates • runs on this device'}
        </MonoLabel>
      </main>
      <FlowFooter>
        <StepButtons onBack={() => back()}>
          <BrutalistButton
            variant={accentVariant(tone)}
            size="lg"
            className="w-full"
            iconRight={ArrowRight}
            disabled={!params.topic.trim() || !params.subject.trim() || (connected && objectives.length === 0)}
            onClick={() => navigate('ai-format')}
          >
            Choose Format
          </BrutalistButton>
        </StepButtons>
      </FlowFooter>
    </div>
  )
}
