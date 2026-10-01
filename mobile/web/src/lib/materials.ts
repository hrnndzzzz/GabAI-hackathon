import type { GenerateMaterial, MaterialContent, MaterialKind, MaterialOut } from './api'
import { MODES, TIERS, type Draft, type DraftParams, type DraftSection, type Mode, type Refinement } from './lessons'
import { lessonMinutes, levelOf, studentLevel } from './levels'

// Maps the AI Assistant's choices onto POST /materials/generate and turns the
// structured MaterialContent that comes back into an editable draft.

const MODE_KIND: Record<Mode, MaterialKind> = {
  lesson: 'lesson_plan',
  rubric: 'rubric',
  remedial: 'activity',
  quiz: 'quiz',
}

const KIND_MODE: Partial<Record<MaterialKind, Mode>> = {
  lesson_plan: 'lesson',
  rubric: 'rubric',
  activity: 'remedial',
  quiz: 'quiz',
}

const TIER_PREFERENCE: Record<DraftParams['tier'], string> = {
  standard: 'On-level pacing and grade-level vocabulary.',
  remedial: 'Simplified for remedial learners: short steps, a word bank, sentence starters and frequent checks.',
  honors: 'Advanced honors: extension tasks, data analysis and open-ended inquiry.',
}

export function objectiveList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20)
}

export function generationRequest(params: DraftParams): GenerateMaterial {
  const minutes = lessonMinutes(levelOf(params), params.grade)
  const extras: string[] = [`Subject: ${params.subject}.`, TIER_PREFERENCE[params.tier]]
  if (params.mode === 'lesson') extras.push(`About ${minutes} minutes with sections for Objective, Warm-up, Core Activity and Exit Ticket.`)
  if (params.mode === 'remedial') extras.push('Format it as a remedial worksheet: recall warm-up, guided practice, then an exit ticket.')
  if (params.mode === 'quiz') extras.push(`About ${params.tier === 'remedial' ? 4 : params.tier === 'honors' ? 6 : 5} multiple-choice questions.`)
  if (params.mode === 'rubric') extras.push('Four performance levels per criterion, from exemplary to beginning.')
  extras.push('Classroom in the Philippines; no internet needed for student activities.')
  return {
    kind: MODE_KIND[params.mode],
    topic: params.topic.trim(),
    student_level: studentLevel(levelOf(params), params.grade),
    objectives: objectiveList(params.objectives),
    preferences: extras.join(' '),
  }
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function structuredSections(content: MaterialContent): DraftSection[] {
  const sections: DraftSection[] = []
  if (content.quiz_questions.length) {
    sections.push({
      id: 'quiz',
      title: 'Quiz Questions',
      readonly: true,
      body: content.quiz_questions
        .map((q) => `${q.number}. ${q.prompt}\n  ${q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join('   ')}`)
        .join('\n'),
    })
    sections.push({
      id: 'quiz-key',
      title: 'Answer Key',
      readonly: true,
      body: content.quiz_questions.map((q) => `${q.number}. ${q.answer}${q.explanation ? ` · ${q.explanation}` : ''}`).join('\n'),
    })
  }
  if (content.rubric_criteria.length) {
    sections.push({
      id: 'rubric',
      title: 'Rubric Criteria',
      readonly: true,
      body: content.rubric_criteria
        .map((c) => `- **${c.criterion} (${c.max_points} pts):** ${c.descriptors.join(' / ')}`)
        .join('\n'),
    })
  }
  return sections
}

export function materialToDraft(material: MaterialOut, params?: DraftParams): Draft {
  const { content } = material
  const mode = KIND_MODE[material.kind] ?? params?.mode ?? 'lesson'
  const editable: DraftSection[] = content.sections.map((s, i) => ({ id: `s${i}`, title: s.heading, body: s.body }))
  if (content.rewritten_text) editable.push({ id: 'rewritten', title: 'Rewritten text', body: content.rewritten_text })
  const grade = params?.grade ?? 9
  const level = params?.level ?? 'highschool'
  return {
    topic: params?.topic ?? content.title,
    subject: params?.subject ?? '',
    level,
    grade,
    mode,
    tier: params?.tier ?? 'standard',
    format: params?.format ?? 'pdf',
    objectives: params?.objectives ?? '',
    id: material.id,
    title: content.title,
    minutes: lessonMinutes(level, grade),
    sections: [...editable, ...structuredSections(content)],
    refinements: [],
    createdISO: material.created_at,
    origin: 'gemini',
    material: {
      id: material.id,
      kind: material.kind,
      revision: material.revision,
      status: material.status,
      provenance: material.provenance,
      quiz: content.quiz_questions,
      rubric: content.rubric_criteria,
    },
  }
}

/** The PATCH body: editable sections as text, quiz and rubric passed through untouched. */
export function draftToMaterialContent(draft: Draft): MaterialContent {
  const editable = draft.sections.filter((s) => !s.readonly && s.id !== 'rewritten')
  const rewritten = draft.sections.find((s) => s.id === 'rewritten')
  return {
    title: draft.title.trim().slice(0, 200) || 'Untitled draft',
    sections: editable
      .filter((s) => s.body.trim())
      .map((s) => ({ heading: s.title.trim().slice(0, 200) || 'Section', body: s.body.trim().slice(0, 12000) })),
    quiz_questions: draft.material?.quiz ?? [],
    rubric_criteria: draft.material?.rubric ?? [],
    rewritten_text: rewritten ? rewritten.body : null,
  }
}

const REWRITE_INSTRUCTION: Record<Refinement, string> = {
  review: 'Keep every section and append one new section titled "Review Questions" with exactly 3 review questions.',
  simplify: 'Simplify the vocabulary for the stated level without dropping any content or sections.',
  bilingual:
    'Make it bilingual: after each paragraph or list, add the Filipino (Tagalog) translation on a new line starting with "> Sa Filipino:".',
}

export function editableMarkdown(draft: Draft): string {
  return draft.sections
    .filter((s) => !s.readonly)
    .map((s) => `## ${s.title}\n${s.body}`)
    .join('\n\n')
}

export function rewriteRequest(draft: Draft, refinement: Refinement): GenerateMaterial {
  const objectives = objectiveList(draft.objectives)
  return {
    kind: 'rewrite',
    topic: draft.topic.slice(0, 500) || draft.title.slice(0, 500),
    student_level: studentLevel(levelOf(draft), draft.grade),
    objectives: objectives.length ? objectives : [`Teach ${draft.topic || draft.title}`.slice(0, 500)],
    preferences: `${REWRITE_INSTRUCTION[refinement]} Return the complete text. Start each section with a line "## <section title>".`,
    source_text: editableMarkdown(draft).slice(0, 30000),
  }
}

/** Splits rewritten text back into sections on "## " headings; falls back to one section. */
export function applyRewrite(draft: Draft, rewritten: string, refinement: Refinement): Draft {
  const parts = rewritten.split(/^##\s+/m).map((p) => p.trim()).filter(Boolean)
  const parsed: DraftSection[] = rewritten.includes('## ')
    ? parts.map((part, i) => {
        const [title, ...body] = part.split('\n')
        return { id: `r${Date.now().toString(36)}-${i}`, title: title.trim(), body: body.join('\n').trim() || title.trim() }
      })
    : [{ id: `r${Date.now().toString(36)}`, title: 'Draft', body: rewritten.trim() }]
  return {
    ...draft,
    sections: [...parsed, ...draft.sections.filter((s) => s.readonly)],
    refinements: [...draft.refinements, refinement],
    dirty: true,
  }
}

export function modeLabel(draft: Draft): string {
  if (draft.material?.kind === 'rewrite') return 'Rewrite'
  return MODES[draft.mode].label
}

export function tierLabel(draft: Draft): string {
  return TIERS[draft.tier].label
}
