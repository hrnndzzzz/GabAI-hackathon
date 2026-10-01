import type { AssessmentCreate, OfflineSubmission } from './api'
import type { Draft } from './lessons'
import { scorePercent, toHundredths, type Adjustment, type Answer, type KeyQuestion, type Score } from './scoring'

// Everything a teacher's device holds. Each signed-in account (and the demo) gets
// its own workspace, so records never mix between teachers sharing a phone.

/** local: never leaves the device (demo). pending: queued for upload. */
export type SyncState = 'local' | 'pending' | 'synced' | 'conflict' | 'failed'
export type Origin = 'demo' | 'device' | 'server'

export interface LocalKey {
  id: string
  /** Assigned by the server on upload; null until then. */
  version: number | null
  verified: boolean
  questions: KeyQuestion[]
}

export interface LocalAssessment {
  id: string
  title: string
  classLabel: string
  assessmentDate: string
  key: LocalKey
  /** Device-only topic names per question, used to word feedback. Never uploaded. */
  topics: Record<number, string>
  /** Demo papers waiting to be scanned, in order. */
  roster: string[]
  urgent: boolean
  due: string | null
  origin: Origin
  sync: SyncState
  syncError?: string
  createdISO: string
}

export interface LocalSubmission {
  id: string
  assessmentId: string
  keyId: string
  keyVersion: number | null
  studentLabel: string
  classLabel: string
  assessmentTitle: string
  source: 'on_device' | 'gemini' | 'manual'
  answers: Answer[]
  adjustments: Adjustment[]
  score: Score
  approvedISO: string
  feedback: string
  origin: Origin
  sync: SyncState
  syncError?: string
}

export interface SavedModule {
  id: string
  draft: Draft
  savedISO: string
}

interface OutboxBase {
  id: string
  refId: string
  attempts: number
  /** Set when the server rejected the upload; such items wait for the teacher instead of retrying. */
  lastError?: string
  conflict?: boolean
}

export type OutboxItem =
  | (OutboxBase & { kind: 'assessment'; payload: AssessmentCreate })
  | (OutboxBase & { kind: 'submission'; assessmentId: string; payload: OfflineSubmission })

export interface Workspace {
  displayName: string
  assessments: LocalAssessment[]
  submissions: LocalSubmission[]
  modules: SavedModule[]
  /** Exact payloads retained for idempotent retries (frontend-integration.md, step 4). */
  outbox: OutboxItem[]
  readNotifications: string[]
  localSync: boolean
  lastSyncedISO: string | null
}

export function emptyWorkspace(displayName: string): Workspace {
  return {
    displayName,
    assessments: [],
    submissions: [],
    modules: [],
    outbox: [],
    readNotifications: [],
    localSync: true,
    lastSyncedISO: null,
  }
}

/** A row in Records: an approved result, whether scanned here, downloaded or demo history. */
export interface RecordRow {
  id: string
  student: string
  classLabel: string
  assessment: string
  finalScore: string
  possibleScore: string
  percent: number
  dateISO: string
  missed: number[]
  feedback: string
  sync: SyncState
}

export function submissionRow(s: LocalSubmission): RecordRow {
  return {
    id: s.id,
    student: s.studentLabel,
    classLabel: s.classLabel,
    assessment: s.assessmentTitle,
    finalScore: s.score.final_score,
    possibleScore: s.score.possible_score,
    percent: scorePercent(s.score),
    dateISO: s.approvedISO,
    missed: missedNumbers(s.score),
    feedback: s.feedback,
    sync: s.sync,
  }
}

export function missedNumbers(score: Score): number[] {
  return score.items
    .filter((i) => i.final_score !== null && toHundredths(i.final_score) < toHundredths(i.possible_score))
    .map((i) => i.number)
}

export function newId(): string {
  return crypto.randomUUID()
}

/** Timezone-aware local timestamp, as the upload contract asks for. */
export function localIsoWithOffset(date = new Date()): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  )
}

export function todayISODate(date = new Date()): string {
  return localIsoWithOffset(date).slice(0, 10)
}
