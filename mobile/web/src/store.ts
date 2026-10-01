import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { ApiError, api, describeError } from './lib/api'
import { signOut as supabaseSignOut } from './lib/auth'
import { classForLabel, dataUrlToBlob, blobToDataUrl, earliest, mergeDownload, preferencesBody, settingsFromPreferences } from './lib/accountSync'
import { classLabel, type TeacherClass } from './lib/classes'
import { getConfig } from './lib/config'
import type { CalendarEvent } from './lib/calendar'
import { buildFeedback, type FeedbackOptions } from './lib/grading'
import { applyRefinement, generateDraft, suggestedObjectives, type Draft, type DraftParams, type Refinement } from './lib/lessons'
import { applyRewrite, draftToMaterialContent, generationRequest, materialToDraft, rewriteRequest } from './lib/materials'
import { DEMO_ASSESSMENTS, DEMO_CLASSES, DEMO_PROFILE, DEMO_TEACHER, LATE_PAPERS, demoEvents } from './lib/mock'
import { demoRecognize, extractionToAnswers, guessStudentName, toJpegBlob } from './lib/ocr'
import { calculate, normalize, type Adjustment, type Answer, type AnswerState, type KeyQuestion } from './lib/scoring'
import { useSettings } from './lib/settings'
import { assessmentPayload, classPayload, eventPayload, submissionPayload } from './lib/sync'
import {
  emptyWorkspace,
  noPending,
  localIsoWithOffset,
  newId,
  type LocalAssessment,
  type LocalSubmission,
  type OutboxItem,
  type PendingSync,
  type SavedModule,
  type TeacherProfile,
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
  | 'account'
  | 'settings'
  | 'notif-settings'
  | 'help'
  | 'about'
  | 'timer'
  | 'calendar'

export type Session = { mode: 'demo' } | { mode: 'connected'; userId: string; email: string }

/** online/offline describe the last server contact; the others block online actions until fixed. */
export type Connection = 'unknown' | 'online' | 'offline' | 'signed_out' | 'mfa_required'

export type CaptureSource = 'camera' | 'gallery' | 'sample'

export type HubPanel = 'ocr' | 'ai' | 'archive'

export type RecordsTab = 'sections' | 'papers' | 'modules'

export interface AuthNotice {
  tone: 'green' | 'coral'
  text: string
  /** Offer "Send a new confirmation link". */
  resend?: boolean
}

export interface ScanSession {
  assessmentId: string
  /** Stable UUID for the eventual submission upload. */
  submissionId: string
  student: string
  paperNumber: number | null
  paperCount: number | null
  image: string | null
  imageSource: CaptureSource | null
  /** When the paper was photographed or picked: its hand-in time for "late". */
  capturedISO: string | null
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
  classId: string
  assessmentDate: string
  dueISO: string | null
  questions: KeyQuestion[]
}

/** A generated file shown in the in-app viewer before it is shared or printed. */
export interface PreviewFile {
  title: string
  fileName: string
  mime: string
  kind: 'html' | 'markdown' | 'csv'
  content: string
}

/** Details entered while registering, applied to the workspace at the first sign-in. */
export interface PendingProfile {
  profile: TeacherProfile
  classes: TeacherClass[]
}

interface Persisted {
  session: Session | null
  workspaces: Record<string, Workspace>
  pendingProfiles: Record<string, PendingProfile>
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
  /** Before sign-in: the login form or the registration flow. */
  authView: 'login' | 'register'
  /** Email to prefill on the sign-in form (after registering). */
  authEmail: string
  /** Shown on the sign-in form, e.g. after the confirmation link reopens the app. */
  authNotice: AuthNotice | null
  /** Records opened for one section (null = everything the teacher handles). */
  recordsScope: string | null
  /** Tab to show when the all-sections Records screen opens. */
  recordsTab: RecordsTab
  /** One scope per Records screen on the stack, so Back restores the previous one. */
  recordsScopes: (string | null)[]
  preview: PreviewFile | null

  enterDemo: () => void
  enterConnected: (user: { id: string; email: string }, displayName: string) => void
  signOut: () => Promise<void>
  setMfaPrompt: (open: boolean) => void
  setAuthView: (view: 'login' | 'register', email?: string) => void
  setAuthNotice: (notice: AuthNotice | null) => void
  savePendingProfile: (email: string, pending: PendingProfile) => void

  setHubPanel: (panel: HubPanel | null) => void
  navigate: (screen: Screen) => void
  resetTo: (stack: Screen[]) => void
  back: () => boolean

  beginScan: (assessmentId?: string, opts?: { resetStack?: boolean }) => boolean
  /** Point the open scanner at another assessment before capturing. */
  switchScan: (assessmentId: string) => void
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
  updateProfile: (profile: TeacherProfile) => void
  upsertClass: (c: TeacherClass) => void
  removeClass: (id: string) => void
  upsertEvent: (e: CalendarEvent) => void
  removeEvent: (id: string) => void
  /** Device settings changed: copy them to the account on the next sync. */
  markPreferencesPending: () => void
  dismissNotifications: (ids: string[]) => void
  openRecords: (classId: string | null, tab?: RecordsTab) => void
  openPreview: (file: PreviewFile) => void
  closePreview: () => void
  resetDemo: () => void

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

/**
 * Papers still to grade: students on the section's class list with no approved result for this
 * assessment (the same rule Records uses), or what is left of a demo queue without a class list.
 */
export function awaitingFor(ws: Workspace, a: LocalAssessment): number {
  const done = ws.submissions.filter((s) => s.assessmentId === a.id)
  const students = ws.classes.find((c) => c.id === a.classId)?.students ?? []
  if (students.length) {
    const graded = new Set(done.map((s) => s.studentLabel))
    return students.filter((name) => !graded.has(name)).length
  }
  return Math.max(0, a.roster.length - done.length)
}

/** Papers still waiting and due within a day (or overdue), or flagged urgent in the demo. */
export function isUrgent(ws: Workspace, a: LocalAssessment, now = Date.now()): boolean {
  if (!awaitingFor(ws, a)) return false
  return a.urgent || (!!a.dueISO && Date.parse(a.dueISO) - now < 86400000)
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
    profile: DEMO_PROFILE,
    classes: DEMO_CLASSES,
    events: demoEvents(),
    assessments: DEMO_ASSESSMENTS,
    modules: demoModules(),
    readNotifications: ['n-demo'],
    lastSyncedISO: new Date(Date.now() - 2 * 60000).toISOString(),
  }
}

/** Fills fields added after a workspace was first saved (persist version 3). */
function upgradeWorkspace(id: string, w: Partial<Workspace>): Workspace {
  if (id === 'demo') {
    const base = { ...emptyWorkspace(DEMO_TEACHER.display), ...w }
    return {
      ...base,
      profile: base.profile ?? DEMO_PROFILE,
      classes: base.classes.length ? base.classes : DEMO_CLASSES,
      events: base.events.length ? base.events : demoEvents(),
      // Demo assessments are regenerated so they pick up classes and due times; ids are unchanged.
      assessments: [...DEMO_ASSESSMENTS, ...base.assessments.filter((a) => a.origin !== 'demo')],
      submissions: base.submissions.map((s) => ({ ...s, classId: s.classId ?? DEMO_ASSESSMENTS.find((a) => a.id === s.assessmentId)?.classId ?? null })),
    }
  }
  const base = { ...emptyWorkspace(w.displayName ?? ''), ...w }
  let classes = base.classes
  const assessments = base.assessments.map((a) => {
    if (a.classId) return { ...a, dueISO: a.dueISO ?? null }
    const link = classForLabel(classes, a.classLabel)
    classes = link.classes
    return { ...a, classId: link.id, dueISO: a.dueISO ?? null }
  })
  const submissions = base.submissions.map((s) => ({ ...s, classId: s.classId ?? assessments.find((a) => a.id === s.assessmentId)?.classId ?? null }))
  // Accounts from before server sync of sections, schedule and profile upload them once (PUT is idempotent).
  const pending: PendingSync = w.pending ?? {
    ...noPending(),
    classes: classes.map((c) => c.id),
    events: base.events.map((e) => e.id),
    profile: !!base.profile,
    avatar: base.profile?.avatar.photo ? 'upload' : null,
  }
  return { ...base, classes, assessments, submissions, pending }
}

/** Set when settings come from the account, so they are not queued straight back as a local change. */
export let applyingAccountSettings = false

function applyAccountSettings(patch: Parameters<ReturnType<typeof useSettings.getState>['update']>[0]) {
  applyingAccountSettings = true
  try {
    useSettings.getState().update(patch)
  } finally {
    applyingAccountSettings = false
  }
}

const DEFAULT_FEEDBACK: FeedbackOptions = { warm: false, nextStep: true, short: false, bilingual: false }

/** Papers expected for an assessment: its section's class list, else the demo queue. */
export function expectedPapers(w: Workspace, a: LocalAssessment): number {
  return w.classes.find((c) => c.id === a.classId)?.students.length || a.roster.length
}

function freshScan(w: Workspace, a: LocalAssessment): ScanSession {
  const submissions = w.submissions.filter((s) => s.assessmentId === a.id)
  const done = submissions.length
  const expected = expectedPapers(w, a)
  // Demo papers arrive in queue order, then the rest of the class list; real papers start
  // unnamed (the name is read from the paper or typed).
  const graded = new Set(submissions.map((s) => s.studentLabel))
  const queue = [...new Set([...a.roster, ...(w.classes.find((c) => c.id === a.classId)?.students ?? [])])]
  const student =
    a.origin === 'demo' ? (queue.find((name) => !graded.has(name)) ?? LATE_PAPERS[done % LATE_PAPERS.length]) : ''
  return {
    assessmentId: a.id,
    submissionId: newId(),
    student,
    paperNumber: done + 1,
    paperCount: expected ? Math.max(expected, done + 1) : null,
    image: null,
    imageSource: null,
    capturedISO: null,
    recognizer: null,
    ocr: { status: 'idle' },
    answers: [],
    adjustments: [],
    feedback: null,
    feedbackOpts: DEFAULT_FEEDBACK,
  }
}

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
      /** Queue an upload of local edits; only signed-in accounts sync. */
      const markPending = (fn: (p: PendingSync) => PendingSync) => {
        if (isConnected(get().session)) patchWs((w) => ({ ...w, pending: fn(w.pending) }))
      }

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
        authView: 'login',
        authEmail: '',
        authNotice: null,
        recordsScope: null,
        recordsScopes: [],
        recordsTab: 'sections',
        preview: null,
        pendingProfiles: {},

        enterDemo: () =>
          set((s) => ({
            session: { mode: 'demo' },
            workspaces: s.workspaces.demo ? s.workspaces : { ...s.workspaces, demo: demoWorkspace() },
            stack: ['hub'],
            connection: 'unknown',
          })),
        enterConnected: (user, displayName) => {
          const id = `user:${user.id}`
          const email = user.email.toLowerCase()
          set((s) => {
            const existing = s.workspaces[id] ?? emptyWorkspace(displayName)
            // Details typed while registering are applied the first time this account signs in here.
            const pending = s.pendingProfiles[email]
            const { [email]: _used, ...rest } = s.pendingProfiles
            const applied = pending && !existing.profile
            const ws = applied
              ? {
                  ...existing,
                  profile: pending.profile,
                  classes: [...existing.classes, ...pending.classes],
                  pending: {
                    ...existing.pending,
                    profile: true,
                    avatar: pending.profile.avatar.photo ? ('upload' as const) : existing.pending.avatar,
                    classes: [...new Set([...existing.pending.classes, ...pending.classes.map((c) => c.id)])],
                  },
                }
              : existing
            return {
              session: { mode: 'connected', userId: user.id, email: user.email },
              workspaces: { ...s.workspaces, [id]: { ...ws, displayName: ws.profile?.fullName || displayName } },
              pendingProfiles: pending ? rest : s.pendingProfiles,
              stack: ['hub'],
              connection: 'online',
              mfaPrompt: false,
              authView: 'login',
            }
          })
          void get().syncNow({ quiet: true })
        },
        signOut: async () => {
          if (isConnected(get().session)) await supabaseSignOut().catch(() => undefined)
          set({ session: null, stack: ['hub'], hubPanel: null, hubScroll: 0, scan: null, draft: null, connection: 'unknown', mfaPrompt: false })
        },
        setMfaPrompt: (open) => set({ mfaPrompt: open }),
        setAuthView: (view, email) => set((s) => ({ authView: view, authEmail: email ?? s.authEmail })),
        setAuthNotice: (notice) => set({ authNotice: notice }),
        savePendingProfile: (email, pending) =>
          set((s) => ({ pendingProfiles: { ...s.pendingProfiles, [email.toLowerCase()]: pending } })),

        setHubPanel: (panel) => set({ hubPanel: panel }),
        navigate: (screen) => set((s) => ({ stack: [...s.stack, screen] })),
        resetTo: (stack) => set({ stack, ...(stack.includes('records') ? {} : { recordsScopes: [], recordsScope: null }) }),
        back: () => {
          const { stack, session, recordsScopes } = get()
          if (!session || stack.length <= 1) return false
          if (stack[stack.length - 1] === 'records') {
            const scopes = recordsScopes.slice(0, -1)
            set({ stack: stack.slice(0, -1), recordsScopes: scopes, recordsScope: scopes[scopes.length - 1] ?? null })
          } else {
            set({ stack: stack.slice(0, -1) })
          }
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
          set((s) => ({
            scan: freshScan(w, a),
            stack: opts?.resetStack ? ['hub', 'scan-capture'] : [...s.stack, 'scan-capture'],
          }))
          return true
        },
        switchScan: (assessmentId) => {
          const a = findAssessment(assessmentId)
          if (a?.key.questions.length) set({ scan: freshScan(ws(), a) })
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
              capturedISO: localIsoWithOffset(),
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
            classId: a.classId,
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
            submittedISO: scan.capturedISO,
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
          const cls = ws().classes.find((c) => c.id === input.classId)
          const assessment: LocalAssessment = {
            id: newId(),
            title: input.title.trim(),
            classId: input.classId,
            classLabel: cls ? classLabel(cls) : 'Unassigned class',
            assessmentDate: input.assessmentDate,
            dueISO: input.dueISO,
            key: { id: newId(), version: null, verified: true, questions: input.questions },
            topics: {},
            roster: [],
            urgent: false,
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

          const clear = (fn: (p: PendingSync) => PendingSync) => forOwner((w) => ({ ...w, pending: fn(w.pending) }))
          /** Offline, sign-in and server hiccups stop the run and keep everything queued. */
          const stops = (error: unknown) => error instanceof ApiError && (error.transient || error.status === 401 || error.status === 403)

          const run = async () => {
            set({ syncing: true })
            const issues: string[] = []
            try {
              const start = ws()
              const since = start.serverTime
              let uploadedAvatar = false

              // 1. Profile, picture and settings.
              if (start.pending.profile && start.profile) {
                const p = start.profile
                await api.updateMe({
                  display_name: (p.fullName || start.displayName || 'Teacher').slice(0, 120),
                  full_name: p.fullName.slice(0, 120) || null,
                  school_name: p.school.slice(0, 160) || null,
                  avatar: { style: p.avatar.style, color: p.avatar.color ?? null, pattern: p.avatar.style === 'pattern' ? (p.avatar.pattern ?? 'blocks') : null },
                })
                clear((x) => ({ ...x, profile: false }))
              }
              if (start.pending.avatar === 'upload') {
                const photo = ws().profile?.avatar.photo
                if (photo) {
                  await api.uploadAvatar(await dataUrlToBlob(photo))
                  uploadedAvatar = true
                }
                clear((x) => ({ ...x, avatar: null }))
              } else if (start.pending.avatar === 'delete') {
                await api.deleteAvatar()
                clear((x) => ({ ...x, avatar: null }))
              }
              if (start.pending.preferences) {
                await api.savePreferences(preferencesBody(useSettings.getState()))
                clear((x) => ({ ...x, preferences: false }))
              }

              // 2. Sections, before the assessments and schedule items that point at them.
              for (const id of start.pending.archivedClasses) {
                try {
                  await api.archiveClass(id)
                } catch (error) {
                  // Never reached the server: nothing to archive there.
                  if (!(error instanceof ApiError && error.status === 404)) throw error
                }
                clear((x) => ({ ...x, archivedClasses: x.archivedClasses.filter((c) => c !== id) }))
              }
              for (const id of start.pending.classes) {
                const cls = ws().classes.find((c) => c.id === id)
                try {
                  if (cls) await api.saveClass(id, classPayload(cls))
                } catch (error) {
                  if (stops(error)) throw error
                  issues.push(`${cls ? classLabel(cls) : 'A section'}: ${describeError(error)}`)
                }
                clear((x) => ({ ...x, classes: x.classes.filter((c) => c !== id) }))
              }

              // 3. Results queue, in order: an assessment (with its verified key) before its results.
              for (const item of [...ws().outbox]) {
                // Rejected uploads wait for the teacher (Records); never retry them automatically.
                if (item.lastError) continue
                if (item.kind === 'assessment' && item.payload.class_id && ws().pending.classes.includes(item.payload.class_id)) continue
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
                  if (stops(error)) throw error
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

              // 4. Schedule items, once the sections and assessments they mention are on the server.
              for (const id of start.pending.deletedEvents) {
                try {
                  await api.deleteEvent(id)
                } catch (error) {
                  if (!(error instanceof ApiError && error.status === 404)) throw error
                }
                clear((x) => ({ ...x, deletedEvents: x.deletedEvents.filter((e) => e !== id) }))
              }
              for (const id of ws().pending.events) {
                const event = ws().events.find((e) => e.id === id)
                const unsynced = (assessmentId: string | null) => {
                  const a = assessmentId ? findAssessment(assessmentId) : undefined
                  return !!a && a.origin !== 'server' && a.sync !== 'synced'
                }
                if (event && ((event.classId && ws().pending.classes.includes(event.classId)) || unsynced(event.assessmentId))) continue
                try {
                  if (event) await api.saveEvent(id, eventPayload(event))
                } catch (error) {
                  if (stops(error)) throw error
                  issues.push(`${event?.title ?? 'A schedule item'}: ${describeError(error)}`)
                }
                clear((x) => ({ ...x, events: x.events.filter((e) => e !== id) }))
              }

              // 5. Download only what changed since the last sync (everything on the first one).
              const [me, classes, events, assessments, submissions, materials, preferences] = await Promise.all([
                api.me(),
                api.listClasses(since),
                api.listEvents(since),
                api.listAssessments(since),
                api.listApprovedSubmissions(since),
                api.listMaterials(since),
                since ? Promise.resolve(null) : api.preferences(),
              ])
              let photo: string | null | undefined
              const now = ws()
              if (!uploadedAvatar && !now.pending.avatar) {
                if (me.avatar?.has_photo && me.avatar.photo_updated_at !== now.avatarSyncedISO) {
                  const blob = await api.avatar()
                  photo = blob ? await blobToDataUrl(blob) : null
                } else if (me.avatar && !me.avatar.has_photo && now.avatarSyncedISO) {
                  photo = null // Removed on another device.
                }
              }
              forOwner((w) =>
                mergeDownload(w, {
                  me,
                  photo,
                  uploadedAvatar,
                  classes: classes.items,
                  events: events.items,
                  assessments: assessments.items,
                  submissions: submissions.items,
                  materials: materials.items,
                  serverTime: earliest([classes.serverTime, events.serverTime, assessments.serverTime, submissions.serverTime, materials.serverTime]),
                }),
              )
              // A phone signing in for the first time takes the account's settings.
              if (preferences?.updated_at && !ws().pending.preferences) applyAccountSettings(settingsFromPreferences(preferences))
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
        updateProfile: (profile) => {
          const before = ws().profile?.avatar.photo ?? null
          const photo = profile.avatar.photo ?? null
          patchWs((w) => ({ ...w, profile, displayName: profile.fullName || w.displayName }))
          markPending((p) => ({
            ...p,
            profile: true,
            avatar: photo && photo !== before ? 'upload' : before && !photo ? 'delete' : p.avatar,
          }))
          void get().syncNow({ quiet: true })
        },
        upsertClass: (c) => {
          patchWs((w) => {
            const exists = w.classes.some((x) => x.id === c.id)
            const label = classLabel(c)
            return {
              ...w,
              classes: exists ? w.classes.map((x) => (x.id === c.id ? c : x)) : [...w.classes, c],
              // Keep labels on assessments and results in step with a renamed section.
              assessments: w.assessments.map((a) => (a.classId === c.id ? { ...a, classLabel: label } : a)),
              submissions: w.submissions.map((s) => (s.classId === c.id ? { ...s, classLabel: label } : s)),
            }
          })
          markPending((p) => ({ ...p, classes: [...new Set([...p.classes, c.id])], archivedClasses: p.archivedClasses.filter((x) => x !== c.id) }))
          void get().syncNow({ quiet: true })
        },
        removeClass: (id) => {
          patchWs((w) => ({ ...w, classes: w.classes.filter((c) => c.id !== id) }))
          markPending((p) => ({ ...p, classes: p.classes.filter((x) => x !== id), archivedClasses: [...new Set([...p.archivedClasses, id])] }))
          void get().syncNow({ quiet: true })
        },
        upsertEvent: (e) => {
          patchWs((w) => ({ ...w, events: w.events.some((x) => x.id === e.id) ? w.events.map((x) => (x.id === e.id ? e : x)) : [...w.events, e] }))
          markPending((p) => ({ ...p, events: [...new Set([...p.events, e.id])], deletedEvents: p.deletedEvents.filter((x) => x !== e.id) }))
          void get().syncNow({ quiet: true })
        },
        removeEvent: (id) => {
          patchWs((w) => ({ ...w, events: w.events.filter((e) => e.id !== id) }))
          markPending((p) => ({ ...p, events: p.events.filter((x) => x !== id), deletedEvents: [...new Set([...p.deletedEvents, id])] }))
          void get().syncNow({ quiet: true })
        },
        markPreferencesPending: () => {
          markPending((p) => ({ ...p, preferences: true }))
          void get().syncNow({ quiet: true })
        },
        dismissNotifications: (ids) =>
          patchWs((w) => ({ ...w, dismissedNotifications: [...new Set([...w.dismissedNotifications, ...ids])] })),
        openRecords: (classId, tab = 'sections') =>
          set((s) => ({ recordsScope: classId, recordsTab: tab, recordsScopes: [...s.recordsScopes, classId], stack: [...s.stack, 'records'] })),
        openPreview: (file) => set({ preview: file }),
        closePreview: () => set({ preview: null }),
        resetDemo: () => set((s) => ({ workspaces: { ...s.workspaces, demo: demoWorkspace() }, stack: ['hub'], scan: null, draft: null })),
        showToast: (message, action) => set({ toast: { id: ++toastId, message, actionLabel: action?.label, action: action?.run } }),
        dismissToast: () => set({ toast: null }),
      }
    },
    {
      name: 'gabai-store-v2',
      storage,
      version: 4,
      migrate: (persisted) => {
        const state = persisted as Partial<Persisted>
        const workspaces: Record<string, Workspace> = {}
        for (const [id, w] of Object.entries(state.workspaces ?? {})) workspaces[id] = upgradeWorkspace(id, w)
        return { ...state, workspaces, pendingProfiles: state.pendingProfiles ?? {} } as Persisted
      },
      partialize: (s): Persisted => ({
        session: s.session,
        workspaces: s.workspaces,
        aiParams: s.aiParams,
        pendingProfiles: s.pendingProfiles,
      }),
    },
  ),
)

export const useWorkspace = () => useStore((s) => currentWorkspace(s))
