import type { AssessmentCreate, AssessmentOut, OfflineSubmission, SubmissionOut } from './api'
import { formatHundredths, toHundredths, type Answer, type KeyQuestion, type Score } from './scoring'
import type { LocalAssessment, LocalSubmission } from './workspace'

// Payload builders for the idempotent upload routes and converters for the JSON
// download contracts (docs/frontend-integration.md, "Offline upload and download").

export const TEMPLATE_ID = 'gabai-sheet-v1'

function questionPayload(q: KeyQuestion) {
  return {
    number: q.number,
    kind: q.kind,
    points: q.points,
    choices: q.kind === 'multiple_choice' ? (q.choices ?? []) : [],
    correct_answer: q.kind === 'essay' ? null : (q.correct_answer ?? null),
    alternatives: q.kind === 'essay' ? [] : (q.alternatives ?? []),
    competency_ids: [] as string[],
    ...(q.kind === 'essay' ? { rubric: q.rubric ?? null } : {}),
  }
}

export function assessmentPayload(a: LocalAssessment): AssessmentCreate {
  return {
    id: a.id,
    title: a.title.slice(0, 200),
    template_id: TEMPLATE_ID,
    assessment_date: a.assessmentDate,
    // The backend has no class field on assessments; category is a free label it only stores.
    category: a.classLabel.trim().slice(0, 80) || null,
    answer_key: { id: a.key.id, questions: a.key.questions.map(questionPayload) },
  }
}

function answerPayload(a: Answer): Answer {
  const out: Answer = { number: a.number, state: a.state, value: a.value ?? null }
  if (a.extracted) {
    const e = a.extracted
    out.extracted = { number: e.number, value: e.value, state: e.state, review_flags: e.review_flags, notes: e.notes }
  }
  return out
}

export function submissionPayload(s: LocalSubmission): OfflineSubmission {
  return {
    submission: {
      id: s.id,
      assessment_id: s.assessmentId,
      answer_key_id: s.keyId,
      student_label: s.studentLabel.trim().slice(0, 120),
      source: s.source,
      answers: s.answers.map(answerPayload),
    },
    adjustments: s.adjustments.map((a) => ({ number: a.number, score: a.score, reason: a.reason })),
    teacher_approved: true,
    local_approved_at: s.approvedISO,
    client_score: {
      automatic_score: s.score.automatic_score,
      final_score: s.score.final_score,
      possible_score: s.score.possible_score,
      items: s.score.items,
    },
  }
}

const decimal = (v: string | null) => (v === null ? null : formatHundredths(toHundredths(String(v))))

function scoreFromServer(score: SubmissionOut['score']): Score {
  return {
    items: score.items.map((i) => ({
      number: i.number,
      resolved: i.resolved,
      automatic_score: decimal(i.automatic_score),
      adjusted_score: decimal(i.adjusted_score),
      final_score: decimal(i.final_score),
      possible_score: decimal(i.possible_score)!,
    })),
    automatic_score: decimal(score.automatic_score)!,
    final_score: decimal(score.final_score)!,
    possible_score: decimal(score.possible_score)!,
    unresolved_numbers: score.unresolved_numbers,
    approvable: score.approvable,
  }
}

export function assessmentFromServer(a: AssessmentOut): LocalAssessment | null {
  const keys = [...a.answer_keys].sort((x, y) => y.version - x.version)
  const key = keys.find((k) => k.verified) ?? keys[0]
  if (!key) return null
  return {
    id: a.id,
    title: a.title,
    classLabel: a.category || 'Unassigned class',
    assessmentDate: a.assessment_date,
    key: {
      id: key.id,
      version: key.version,
      verified: key.verified,
      questions: key.questions.map((q) => ({
        number: q.number,
        kind: q.kind,
        points: decimal(String(q.points))!,
        choices: q.choices ?? [],
        correct_answer: q.correct_answer ?? null,
        alternatives: q.alternatives ?? [],
        rubric: q.rubric ?? null,
      })),
    },
    topics: {},
    roster: [],
    urgent: false,
    due: null,
    origin: 'server',
    sync: 'synced',
    createdISO: a.created_at,
  }
}

export function submissionFromServer(s: SubmissionOut, assessments: LocalAssessment[]): LocalSubmission {
  const assessment = assessments.find((a) => a.id === s.assessment_id)
  return {
    id: s.id,
    assessmentId: s.assessment_id,
    keyId: s.answer_key_id,
    keyVersion: s.score.answer_key_version,
    studentLabel: s.student_label,
    classLabel: assessment?.classLabel ?? 'Unassigned class',
    assessmentTitle: assessment?.title ?? 'Assessment',
    source: s.source === 'gemini' || s.source === 'manual' ? s.source : 'on_device',
    answers: s.answers,
    adjustments: [],
    score: scoreFromServer(s.score),
    approvedISO: s.approved_at ?? s.local_approved_at ?? s.created_at,
    feedback: '',
    origin: 'server',
    sync: 'synced',
  }
}
