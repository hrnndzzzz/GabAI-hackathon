import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { ApiError, api, describeError } from './lib/api'
import { signOut as supabaseSignOut } from './lib/auth'
import { getConfig } from './lib/config'
import { buildFeedback, type FeedbackOptions } from './lib/grading'
import { applyRefinement, generateDraft, suggestedObjectives, type Draft, type DraftParams, type Refinement } from './lib/lessons'
import { applyRewrite, draftToMaterialContent, generationRequest, materialToDraft, rewriteRequest } from './lib/materials'
import { DEMO_ASSESSMENTS, DEMO_TEACHER, LATE_PAPERS } from './lib/mock'
import { demoRecognize, extractionToAnswers, guessStudentName, toJpegBlob } from './lib/ocr'
import { calculate, normalize, type Adjustment, type Answer, type AnswerState, type KeyQuestion } from './lib/scoring'
import { assessmentFromServer, assessmentPayload, submissionFromServer, submissionPayload } from './lib/sync'
import {
  emptyWorkspace,
  localIsoWithOffset,
  newId,
  type LocalAssessment,
  type LocalSubmission,
  type OutboxItem,
  type SavedModule,
  type Workspace,
} from './lib/workspace'

export type Screen =
  | 'hub'
  | 'scan-capture'
  | 'scan-ocr'
  | 'scan-match'
  | 'scan-review'
  | 'ai-params'
  | 'ai-format'
  | 'ai-draft'
  | 'records'
  | 'key-editor'

export type Session = { mode: 'demo' } | { mode: 'connected'; userId: string; email: string }

/** online/offline describe the last server contact; the others block online actions until fixed. */
export type Connection = 'unknown' | 'online' | 'offline' | 'signed_out' | 'mfa_required'

export type CaptureSource = 'camera' | 'gallery' | 'sample'

export type HubPanel = 'ocr' | 'ai' | 'archive'

export interface ScanSession {
  assessmentId: string
  /** Stable UUID for the eventual submission upload. */
  submissionId: string
  student: string
  paperNumber: number | null
  paperCount: number | null
  image: string | null
  imageSource: CaptureSource | null
  recognizer: 'demo' | 'gemini' | 'manual' | null
  ocr: { status: 'idle' | 'running' | 'done' | 'failed'; error?: string; notes?: string[] }
  answers: Answer[]
  adjustments: Adjustment[]
  /** null while the teacher has not hand-edited the generated feedback. */
  feedback: string | null
  feedbackOpts: FeedbackOptions
}

export interface Toast {
  id: number
  message: string
  actionLabel?: string
  action?: () => void
}

export interface NewAssessment {
  title: string
  classLabel: string
  assessmentDate: string
  questions: KeyQuestion[]
}

interface Persisted {
  session: Session | null
  workspaces: Record<string, Workspace>
  /** The teacher's last AI Assistant choices (level, grade, subject…), remembered across launches. */
  aiParams: DraftParams
}

interface State extends Persisted {
  stack: Screen[]
  /** Hub accordion and scroll, kept while the app runs so returning from a feature restores them. */
  hubPanel: HubPanel | null
  hubScroll: number
  scan: ScanSession | null
  aiParams: DraftParams
  draft: Draft | null
  toast: Toast | null
  connection: Connection
  syncing: boolean
  /** Shown over the app when online work needs two-step verification first. */
  mfaPrompt: boolean

  enterDemo: () => void
  enterConnected: (user: { id: string; email: string }, displayName: string) => void
  signOut: () => Promise<void>
  setMfaPrompt: (open: boolean) => void

  setHubPanel: (panel: HubPanel | null) => void
  navigate: (screen: Screen) => void
  resetTo: (stack: Screen[]) => void
  back: () => boolean

  beginScan: (assessmentId?: string, opts?: { resetStack?: boolean }) => boolean
  setCapture: (image: string, source: CaptureSource) => void
  runOnlineOcr: () => Promise<void>
  startManualEntry: () => void
  setAnswer: (number: number, state: AnswerState, value: string | null) => void
  confirmAllRecognized: () => number
  setScanStudent: (name: string) => void
  setScanAssessment: (assessmentId: string) => void
  setAdjustment: (adjustment: Adjustment) => void
  removeAdjustment: (number: number) => void
  setFeedback: (text: string | null) => void
  setFeedbackOpts: (opts: FeedbackOptions) => void
  approveScan: () => LocalSubmission

  saveAssessment: (input: NewAssessment) => LocalAssessment
  readReferenceKey: (image: Blob) => Promise<Record<number, string>>

  setAiParams: (params: Partial<DraftParams>) => void
  setDraft: (draft: Draft | null) => void
  generate: () => Promise<void>
  refine: (refinement: Refinement) => Promise<void>
  saveModule: () => Promise<void>
  markReviewed: () => Promise<void>

  markNotificationsRead: (ids: string[]) => void
  setLocalSync: (on: boolean) => void
  syncNow: (opts?: { quiet?: boolean }) => Promise<void>
  retryUpload: (refId: string) => void
  uploadAsNewRecord: (submissionId: string) => void
  dropUpload: (refId: string) => void
  showToast: (message: string, action?: { label: string; run: () => void }) => void
  dismissToast: () => void
}

export function workspaceId(session: Session | null): string {
  if (!session) return 'none'
  return session.mode === 'demo' ? 'demo' : `user:${session.userId}`
}

const FALLBACK = emptyWorkspace('')

export function currentWorkspace(state: Pick<State, 'session' | 'workspaces'>): Workspace {
  return state.workspaces[workspaceId(state.session)] ?? FALLBACK
}

export function isConnected(session: Session | null): session is Extract<Session, { mode: 'connected' }> {
  return session?.mode === 'connected'
}

/** Papers still waiting in a demo roster. */
export function awaitingFor(ws: Workspace, a: LocalAssessment): number {
  const graded = ws.submissions.filter((s) => s.assessmentId === a.id).length
  return Math.max(0, a.roster.length - graded)
}

export function scoreScan(scan: ScanSession, assessment: LocalAssessment) {
  // Answers for questions the chosen key does not have are ignored, not errors.
  const numbers = new Set(assessment.key.questions.map((q) => q.number))
  return calculate(
    assessment.key.questions,
    assessment.key.verified,
    scan.answers.filter((a) => numbers.has(a.number)),
    scan.adjustments.filter((a) => numbers.has(a.number)),
  )
}

function demoModules(): SavedModule[] {
  const seeds: [DraftParams, number][] = [
    [{ topic: 'Photosynthesis & Cellular Respiration', subject: 'Biology', level: 'highschool', grade: 9, mode: 'lesson', tier: 'standard', format: 'pdf', objectives: '' }, 2],
    [{ topic: 'Stoichiometry', subject: 'Chemistry', level: 'highschool', grade: 10, mode: 'quiz', tier: 'standard', format: 'csv', objectives: '' }, 5],
    [{ topic: 'Cellular Respiration', subject: 'Biology', level: 'highschool', grade: 9, mode: 'remedial', tier: 'remedial', format: 'pdf', objectives: '' }, 8],
    [{ topic: 'Photosynthesis Lab Report', subject: 'Biology', level: 'highschool', grade: 9, mode: 'rubric', tier: 'standard', format: 'markdown', objectives: '' }, 12],
  ]
  return seeds.map(([params, days], i) => {
    const savedISO = new Date(Date.now() - days * 86400000).toISOString()
    const id = `module-${i + 1}`
    return { id, draft: { ...generateDraft(params, savedISO), id }, savedISO }
  })
}

function demoWorkspace(): Workspace {
  return {
    ...emptyWorkspace(DEMO_TEACHER.display),
    assessments: DEMO_ASSESSMENTS,
    modules: demoModules(),
    readNotifications: ['n-demo'],
    lastSyncedISO: new Date(Date.now() - 2 * 60000).toISOString(),
  }
}

const DEFAULT_FEEDBACK: FeedbackOptions = { warm: false, nextStep: true, short: false, bilingual: false }

// Pausing Local Storage Sync keeps that workspace's last saved copy on disk and
// holds new changes in memory only; the session itself is always remembered.
const storage: PersistStorage<Persisted> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name)
      return raw ? (JSON.parse(raw) as StorageValue<Persisted>) : null
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      const raw = localStorage.getItem(name)
      const prev = raw ? (JSON.parse(raw) as StorageValue<Persisted>).state.workspaces : {}
      const workspaces: Record<string, Workspace> = {}
      for (const [id, w] of Object.entries(value.state.workspaces)) {
        workspaces[id] = w.localSync ? w : { ...(prev[id] ?? w), localSync: false }
      }
      localStorage.setItem(name, JSON.stringify({ ...value, state: { ...value.state, workspaces } }))
    } catch {
      // Storage can be unavailable (private mode, quota); the app keeps working in memory.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // ignore
    }
  },
}

let toastId = 0
let syncInFlight: Promise<void> | null = null

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const ws = () => currentWorkspace(get())
      const patchWs = (fn: (w: Workspace) => Workspace) =>
        set((s) => ({ workspaces: { ...s.workspaces, [workspaceId(s.session)]: fn(currentWorkspace(s)) } }))
      const findAssessment = (id: string) => ws().assessments.find((a) => a.id === id)

      /** Records what an API failure says about the connection and returns a message. */
      const noteFailure = (error: unknown): string => {
        if (error instanceof ApiError) {
          if (error.code === 'mfa_required') set({ connection: 'mfa_required' })
          else if (error.status === 401) set({ connection: 'signed_out' })
          else if (error.status === 0) set({ connection: 'offline' })
        }
        return describeError(error)
      }

      return {
        session: null,
        workspaces: {},

        stack: ['hub'],
        hubPanel: null,
        hubScroll: 0,
        scan: null,
        aiParams: {
          topic: 'Photosynthesis & Cellular Respiration',
          subject: 'Biology',
          level: 'highschool',
          grade: 9,
          mode: 'lesson',
          tier: 'standard',
          format: 'pdf',
          objectives: suggestedObjectives('Photosynthesis & Cellular Respiration'),
        },
        draft: null,
        toast: null,
        connection: 'unknown',
        syncing: false,
        mfaPrompt: false,

        enterDemo: () =>
          set((s) => ({
            session: { mode: 'demo' },
            workspaces: s.workspaces.demo ? s.workspaces : { ...s.workspaces, demo: demoWorkspace() },
            stack: ['hub'],
            connection: 'unknown',
          })),
        enterConnected: (user, displayName) => {
          const id = `user:${user.id}`
          set((s) => ({
            session: { mode: 'connected', userId: user.id, email: user.email },
            workspaces: { ...s.workspaces, [id]: { ...(s.workspaces[id] ?? emptyWorkspace(displayName)), displayName } },
            stack: ['hub'],
            connection: 'online',
            mfaPrompt: false,
          }))
          void get().syncNow({ quiet: true })
        },
        signOut: async () => {
          if (isConnected(get().session)) await supabaseSignOut().catch(() => undefined)
          set({ session: null, stack: ['hub'], hubPanel: null, hubScroll: 0, scan: null, draft: null, connection: 'unknown', mfaPrompt: false })
        },
        setMfaPrompt: (open) => set({ mfaPrompt: open }),

        setHubPanel: (panel) => set({ hubPanel: panel }),
        navigate: (screen) => set((s) => ({ stack: [...s.stack, screen] })),
        resetTo: (stack) => set({ stack }),
        back: () => {
          const { stack, session } = get()
          if (!session || stack.length <= 1) return false
          set({ stack: stack.slice(0, -1) })
          return true
        },

        beginScan: (assessmentId, opts) => {
          const w = ws()
          const ready = w.assessments.filter((a) => a.key.questions.length)
          const pending = (a: LocalAssessment) => awaitingFor(w, a) > 0
          const a = assessmentId
            ? findAssessment(assessmentId)
            : (ready.find((x) => x.urgent && pending(x)) ?? ready.find(pending) ?? ready[ready.length - 1])
          if (!a) return false
          const done = w.submissions.filter((s) => s.assessmentId === a.id).length
          const student = a.roster.length
            ? done < a.roster.length
              ? a.roster[done]
              : LATE_PAPERS[(done - a.roster.length) % LATE_PAPERS.length]
            : ''
          set((s) => ({
            scan: {
              assessmentId: a.id,
              submissionId: newId(),
              student,
              paperNumber: a.roster.length ? done + 1 : null,
              paperCount: a.roster.length ? Math.max(a.roster.length, done + 1) : null,
              image: null,
              imageSource: null,
              recognizer: null,
              ocr: { status: 'idle' },
              answers: [],
              adjustments: [],
              feedback: null,
              feedbackOpts: DEFAULT_FEEDBACK,
            },
            stack: opts?.resetStack ? ['hub', 'scan-capture'] : [...s.stack, 'scan-capture'],
          }))
          return true
        },
        setCapture: (image, source) => {
          const scan = get().scan
          if (!scan) return
          const a = findAssessment(scan.assessmentId)
          // Demo papers are read by the on-device stand-in. Real papers wait for the teacher to
          // choose online OCR or manual entry: sending a paper to Gemini is an explicit act.
          const demo = get().session?.mode === 'demo' && a
          const answers = demo ? extractionToAnswers(demoRecognize(scan.student, a.key.id, a.key.questions).items) : []
          set((s) => ({
            scan: {
              ...scan,
              image,
              imageSource: source,
              recognizer: demo ? 'demo' : null,
              ocr: { status: demo ? 'done' : 'idle' },
              answers,
              adjustments: [],
              feedback: null,
            },
            stack: [...s.stack, 'scan-ocr'],
          }))
        },
        runOnlineOcr: async () => {
          const scan = get().scan
          if (!scan?.image) return
          set({ scan: { ...scan, ocr: { status: 'running' } } })
          try {
            const result = await api.ocr('student', await toJpegBlob(scan.image))
            const current = get().scan
            if (!current || current.submissionId !== scan.submissionId) return
            set({
              connection: 'online',
              scan: {
                ...current,
                recognizer: 'gemini',
                ocr: { status: 'done', notes: result.notes },
                answers: extractionToAnswers(result.items),
                student: current.student || guessStudentName(result.text),
                feedback: null,
              },
            })
          } catch (error) {
            const message = noteFailure(error)
            const current = get().scan
            if (current) set({ scan: { ...current, ocr: { status: 'failed', error: message } } })
          }
        },
        startManualEntry: () => {
          const scan = get().scan
          if (scan) set({ scan: { ...scan, recognizer: 'manual', ocr: { status: 'done' }, answers: [], feedback: null } })
        },
        setAnswer: (number, state, value) =>
          set((s) => {
            if (!s.scan) return {}
            const existing = s.scan.answers.find((a) => a.number === number)
            const next: Answer = {
              number,
              state,
              value: state === 'confirmed_blank' ? null : value,
              extracted: existing?.extracted ?? null,
            }
            const answers = existing
              ? s.scan.answers.map((a) => (a.number === number ? next : a))
              : [...s.scan.answers, next].sort((a, b) => a.number - b.number)
            return { scan: { ...s.scan, answers, feedback: null } }
          }),
        confirmAllRecognized: () => {
          const scan = get().scan
          const a = scan && findAssessment(scan.assessmentId)
          if (!scan || !a) return 0
          let count = 0
          const answers = scan.answers.map((answer) => {
            const q = a.key.questions.find((x) => x.number === answer.number)
            if (!q || answer.state !== 'recognized' || q.kind === 'essay') return answer
            const value = normalize(answer.value ?? '', q.kind)
            if (!value || (q.kind === 'multiple_choice' && !(q.choices ?? []).includes(value))) return answer
            count++
            return { ...answer, state: 'confirmed' as const, value }
          })
          set({ scan: { ...scan, answers, feedback: null } })
          return count
        },
        setScanStudent: (name) => set((s) => (s.scan ? { scan: { ...s.scan, student: name } } : {})),
        setScanAssessment: (assessmentId) =>
          set((s) => (s.scan ? { scan: { ...s.scan, assessmentId, adjustments: [], feedback: null } } : {})),
        setAdjustment: (adjustment) =>
          set((s) => {
            if (!s.scan) return {}
            const adjustments = [...s.scan.adjustments.filter((a) => a.number !== adjustment.number), adjustment]
            return { scan: { ...s.scan, adjustments: adjustments.sort((a, b) => a.number - b.number), feedback: null } }
          }),
        removeAdjustment: (number) =>
          set((s) =>
            s.scan
              ? { scan: { ...s.scan, adjustments: s.scan.adjustments.filter((a) => a.number !== number), feedback: null } }
              : {},
          ),
        setFeedback: (text) => set((s) => (s.scan ? { scan: { ...s.scan, feedback: text } } : {})),
        setFeedbackOpts: (opts) => set((s) => (s.scan ? { scan: { ...s.scan, feedbackOpts: opts } } : {})),
        approveScan: () => {
          const scan = get().scan
          const a = scan && findAssessment(scan.assessmentId)
          if (!scan || !a) throw new Error('Nothing to approve')
          const score = scoreScan(scan, a)
          if (!score.approvable) throw new Error('Confirm every answer before approving.')
          const numbers = new Set(a.key.questions.map((q) => q.number))
          const connected = isConnected(get().session)
          const submission: LocalSubmission = {
            id: scan.submissionId,
            assessmentId: a.id,
            keyId: a.key.id,
            keyVersion: a.key.version,
            studentLabel: scan.student.trim() || 'Unnamed student',
            classLabel: a.classLabel,
            assessmentTitle: a.title,
            source: scan.recognizer === 'gemini' ? 'gemini' : scan.recognizer === 'manual' ? 'manual' : 'on_device',
            answers: scan.answers.filter((x) => numbers.has(x.number)),
            adjustments: scan.adjustments.filter((x) => numbers.has(x.number)),
            score,
            approvedISO: localIsoWithOffset(),
            feedback: scan.feedback ?? buildFeedback(scan.student, score, a.topics, scan.feedbackOpts),
            origin: a.origin === 'demo' ? 'demo' : 'device',
            sync: connected ? 'pending' : 'local',
          }
          const outboxItem: OutboxItem = {
            id: newId(),
            kind: 'submission',
            refId: submission.id,
            assessmentId: a.id,
            payload: submissionPayload(submission),
            attempts: 0,
          }
          patchWs((w) => ({
            ...w,
            submissions: [submission, ...w.submissions],
            outbox: connected ? [...w.outbox, outboxItem] : w.outbox,
          }))
          if (connected) void get().syncNow({ quiet: true })
          return submission
        },

        saveAssessment: (input) => {
          const connected = isConnected(get().session)
          const assessment: LocalAssessment = {
            id: newId(),
            title: input.title.trim(),
            classLabel: input.classLabel.trim(),
            assessmentDate: input.assessmentDate,
            key: { id: newId(), version: null, verified: true, questions: input.questions },
            topics: {},
            roster: [],
            urgent: false,
            due: null,
            origin: 'device',
            sync: connected ? 'pending' : 'local',
            createdISO: new Date().toISOString(),
          }
          const outboxItem: OutboxItem = {
            id: newId(),
            kind: 'assessment',
            refId: assessment.id,
            payload: assessmentPayload(assessment),
            attempts: 0,
          }
          patchWs((w) => ({
            ...w,
            assessments: [...w.assessments, assessment],
            outbox: connected ? [...w.outbox, outboxItem] : w.outbox,
          }))
          if (connected) void get().syncNow({ quiet: true })
          return assessment
        },
        readReferenceKey: async (image) => {
          try {
            const result = await api.ocr('reference', image)
            set({ connection: 'online' })
            const answers: Record<number, string> = {}
            for (const item of result.items) if (item.state === 'recognized' && item.value) answers[item.number] = item.value
            return answers
          } catch (error) {
            throw new Error(noteFailure(error))
          }
        },

        setAiParams: (params) => set((s) => ({ aiParams: { ...s.aiParams, ...params } })),
        setDraft: (draft) => set({ draft }),
        generate: async () => {
          const params = get().aiParams
          if (!isConnected(get().session)) {
            set({ draft: generateDraft(params) })
            return
          }
          try {
            const material = await api.generateMaterial(generationRequest(params))
            const draft = materialToDraft(material, params)
            set({ draft, connection: 'online' })
            patchWs((w) => ({ ...w, modules: [{ id: draft.id, draft, savedISO: material.updated_at }, ...w.modules] }))
          } catch (error) {
            throw new Error(noteFailure(error))
          }
        },
        refine: async (refinement) => {
          const draft = get().draft
          if (!draft) return
          if (draft.origin === 'template') {
            set({ draft: applyRefinement(draft, refinement) })
            return
          }
          try {
            // A rewrite is its own (billed) generation; its text replaces the editable sections locally.
            const result = await api.generateMaterial(rewriteRequest(draft, refinement))
            const current = get().draft
            if (current?.id === draft.id) {
              set({ draft: applyRewrite(current, result.content.rewritten_text ?? '', refinement), connection: 'online' })
            }
          } catch (error) {
            throw new Error(noteFailure(error))
          }
        },
        saveModule: async () => {
          const draft = get().draft
          if (!draft) return
          let saved = draft
          if (draft.material) {
            try {
              const material = await api.editMaterial(draft.material.id, draft.material.revision, draftToMaterialContent(draft))
              saved = { ...draft, dirty: false, material: { ...draft.material, revision: material.revision, status: material.status } }
              set({ connection: 'online' })
            } catch (error) {
              throw new Error(noteFailure(error))
            }
          }
          set({ draft: saved })
          patchWs((w) => {
            const entry: SavedModule = { id: saved.id, draft: saved, savedISO: new Date().toISOString() }
            const exists = w.modules.some((m) => m.id === saved.id)
            return { ...w, modules: exists ? w.modules.map((m) => (m.id === saved.id ? entry : m)) : [entry, ...w.modules] }
          })
        },
        markReviewed: async () => {
          const draft = get().draft
          if (!draft?.material || draft.dirty) return
          try {
            const material = await api.reviewMaterial(draft.material.id, draft.material.revision)
            const reviewed = { ...draft, material: { ...draft.material, revision: material.revision, status: material.status } }
            set({ draft: reviewed, connection: 'online' })
            patchWs((w) => ({ ...w, modules: w.modules.map((m) => (m.id === reviewed.id ? { ...m, draft: reviewed } : m)) }))
          } catch (error) {
            throw new Error(noteFailure(error))
          }
        },

        markNotificationsRead: (ids) =>
          patchWs((w) => ({ ...w, readNotifications: [...new Set([...w.readNotifications, ...ids])] })),
        setLocalSync: (on) => patchWs((w) => ({ ...w, localSync: on })),

        syncNow: async (opts) => {
          if (!isConnected(get().session) || !getConfig()) {
            patchWs((w) => ({ ...w, lastSyncedISO: new Date().toISOString() }))
            return
          }
          if (syncInFlight) return syncInFlight
          const owner = workspaceId(get().session)
          // Ignore results that land after the teacher switched accounts mid-sync.
          const forOwner = (fn: (w: Workspace) => Workspace) => {
            if (workspaceId(get().session) === owner) patchWs(fn)
          }
          const markRecord = (item: OutboxItem, sync: LocalSubmission['sync'], error?: string, keyVersion?: number) =>
            forOwner((w) =>
              item.kind === 'assessment'
                ? {
                    ...w,
                    assessments: w.assessments.map((a) =>
                      a.id === item.refId
                        ? { ...a, sync, syncError: error, key: keyVersion ? { ...a.key, version: keyVersion } : a.key }
                        : a,
                    ),
                  }
                : {
                    ...w,
                    submissions: w.submissions.map((s) =>
                      s.id === item.refId ? { ...s, sync, syncError: error, keyVersion: keyVersion ?? s.keyVersion } : s,
                    ),
                  },
            )

          const run = async () => {
            set({ syncing: true })
            const issues: string[] = []
            try {
              // 1. Upload in order: an assessment (with its verified key) before its results.
              for (const item of [...ws().outbox]) {
                // Rejected uploads wait for the teacher (Records); never retry them automatically.
                if (item.lastError) continue
                if (item.kind === 'submission') {
                  const parent = findAssessment(item.assessmentId)
                  if (parent && parent.origin !== 'server' && parent.sync !== 'synced') continue
                }
                try {
                  const out =
                    item.kind === 'assessment'
                      ? await api.uploadAssessment(item.payload)
                      : await api.uploadSubmission(item.payload)
                  markRecord(item, 'synced', undefined, out.answer_key_version)
                  forOwner((w) => ({ ...w, outbox: w.outbox.filter((o) => o.id !== item.id) }))
                } catch (error) {
                  // Offline, auth and server hiccups stop the run and keep the queue for later.
                  if (error instanceof ApiError && (error.transient || error.status === 401 || error.status === 403)) throw error
                  // Conflicts and validation failures need the teacher; never retry them in a loop.
                  const conflict = error instanceof ApiError && error.code === 'upload_conflict'
                  const message = describeError(error)
                  markRecord(item, conflict ? 'conflict' : 'failed', message)
                  forOwner((w) => ({
                    ...w,
                    outbox: w.outbox.map((o) =>
                      o.id === item.id ? { ...o, attempts: o.attempts + 1, lastError: message, conflict } : o,
                    ),
                  }))
                  issues.push(message)
                }
              }
              // 2. Download the JSON snapshots and keep anything not already on the device.
              const [assessments, submissions, materials] = await Promise.all([
                api.listAssessments(),
                api.listApprovedSubmissions(),
                api.listMaterials(),
              ])
              forOwner((w) => {
                const known = new Set(w.assessments.map((a) => a.id))
                const added = assessments
                  .filter((a) => !a.archived && !known.has(a.id))
                  .map(assessmentFromServer)
                  .filter((a): a is LocalAssessment => a !== null)
                const allAssessments = [...w.assessments, ...added]
                const knownSubs = new Set(w.submissions.map((s) => s.id))
                const newSubs = submissions.filter((s) => !knownSubs.has(s.id)).map((s) => submissionFromServer(s, allAssessments))
                const localModules = new Map(w.modules.map((m) => [m.id, m]))
                const modules = materials.map((m) => {
                  const local = localModules.get(m.id)
                  // Keep unsaved local edits; otherwise take the server's current revision.
                  if (local?.draft.dirty) return local
                  return { id: m.id, draft: materialToDraft(m, local?.draft), savedISO: m.updated_at }
                })
                return {
                  ...w,
                  assessments: allAssessments,
                  submissions: [...w.submissions, ...newSubs].sort((a, b) => Date.parse(b.approvedISO) - Date.parse(a.approvedISO)),
                  modules,
                  lastSyncedISO: new Date().toISOString(),
                }
              })
              set({ connection: 'online' })
              if (!opts?.quiet) {
                const waiting = ws().outbox.filter((o) => !o.lastError).length
                get().showToast(
                  issues.length
                    ? `Synced with ${issues.length} upload ${issues.length === 1 ? 'issue' : 'issues'}. Check Records.`
                    : waiting
                      ? `Synced • ${waiting} ${waiting === 1 ? 'result is' : 'results are'} still queued`
                      : 'Synced • everything is up to date',
                )
              }
            } catch (error) {
              const message = noteFailure(error)
              if (!opts?.quiet) get().showToast(message)
              if (error instanceof ApiError && error.code === 'mfa_required' && !opts?.quiet) set({ mfaPrompt: true })
            } finally {
              set({ syncing: false })
            }
          }
          syncInFlight = run().finally(() => {
            syncInFlight = null
          })
          return syncInFlight
        },
        retryUpload: (refId) => {
          patchWs((w) => ({
            ...w,
            outbox: w.outbox.map((o) => (o.refId === refId ? { ...o, lastError: undefined, conflict: undefined } : o)),
            submissions: w.submissions.map((s) => (s.id === refId ? { ...s, sync: 'pending', syncError: undefined } : s)),
            assessments: w.assessments.map((a) => (a.id === refId ? { ...a, sync: 'pending', syncError: undefined } : a)),
          }))
          void get().syncNow()
        },
        uploadAsNewRecord: (submissionId) => {
          // The server already holds different content under this UUID: keep both as distinct records.
          const sub = ws().submissions.find((s) => s.id === submissionId)
          if (!sub) return
          const renamed: LocalSubmission = { ...sub, id: newId(), sync: 'pending', syncError: undefined }
          patchWs((w) => ({
            ...w,
            submissions: w.submissions.map((s) => (s.id === submissionId ? renamed : s)),
            outbox: [
              ...w.outbox.filter((o) => o.refId !== submissionId),
              { id: newId(), kind: 'submission', refId: renamed.id, assessmentId: renamed.assessmentId, payload: submissionPayload(renamed), attempts: 0 },
            ],
          }))
          void get().syncNow()
        },
        dropUpload: (refId) =>
          patchWs((w) => ({
            ...w,
            outbox: w.outbox.filter((o) => o.refId !== refId),
            submissions: w.submissions.map((s) => (s.id === refId ? { ...s, sync: 'local', syncError: undefined } : s)),
            assessments: w.assessments.map((a) => (a.id === refId ? { ...a, sync: 'local', syncError: undefined } : a)),
          })),
        showToast: (message, action) => set({ toast: { id: ++toastId, message, actionLabel: action?.label, action: action?.run } }),
        dismissToast: () => set({ toast: null }),
      }
    },
    {
      name: 'gabai-store-v2',
      storage,
      partialize: (s): Persisted => ({ session: s.session, workspaces: s.workspaces, aiParams: s.aiParams }),
    },
  ),
)

export const useWorkspace = () => useStore((s) => currentWorkspace(s))
