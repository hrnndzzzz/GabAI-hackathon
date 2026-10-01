import { accessToken, refreshAccessToken } from './auth'
import { getConfig } from './config'
import type { Adjustment, Answer, ExtractionItem, ItemScore, KeyQuestion, Score } from './scoring'

// Typed client for the routes GabAI uses. Shapes mirror app/schemas.py; every
// payload is built explicitly because the server rejects unknown properties.

export class ApiError extends Error {
  status: number
  code: string
  requestId?: string
  retryAfter?: number
  constructor(status: number, code: string, message: string, requestId?: string, retryAfter?: number) {
    super(message)
    this.status = status
    this.code = code
    this.requestId = requestId
    this.retryAfter = retryAfter
  }
  /** Worth retrying later without changing anything (offline, rate limits, provider/server hiccups). */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

export interface Page<T> {
  items: T[]
  limit: number
  offset: number
  has_more: boolean
  server_time?: string | null
}

export interface AvatarOut {
  style: 'initials' | 'pattern' | 'photo'
  color: string | null
  pattern: string | null
  has_photo: boolean
  photo_updated_at: string | null
}

export interface ProfileOut {
  id: string
  display_name: string
  mfa_required: boolean
  full_name?: string | null
  school_name?: string | null
  avatar?: AvatarOut | null
  updated_at?: string | null
}

export interface ProfileEdit {
  display_name: string
  full_name?: string | null
  school_name?: string | null
  avatar?: { style: 'initials' | 'pattern' | 'photo'; color?: string | null; pattern?: string | null }
}

export interface PreferencesBody {
  notify?: Partial<Record<'urgent' | 'sync' | 'timer' | 'schedule' | 'tips', boolean>>
  theme?: 'light' | 'dark' | 'system'
  reduce_motion?: boolean
  paper_size?: 'A4' | 'Letter'
  default_format?: 'pdf' | 'markdown' | 'csv'
  dock?: string[]
}

export interface PreferencesOut extends PreferencesBody {
  updated_at: string | null
}

export interface ClassBody {
  level: 'elementary' | 'highschool' | 'college'
  grade: number
  section: string
  subject: string
  students: string[]
}

export interface ClassOut extends ClassBody {
  id: string
  student_ids: string[]
  archived: boolean
  revision: number
  updated_at: string
}

export interface EventBody {
  title: string
  type: 'exam' | 'quiz' | 'class' | 'deadline' | 'meeting' | 'reminder'
  starts_at: string
  duration_min: number
  all_day: boolean
  class_id: string | null
  assessment_id: string | null
  notes: string
}

export interface EventOut extends EventBody {
  id: string
  revision: number
  deleted_at: string | null
  updated_at: string
}

export interface QuestionOut extends KeyQuestion {
  id: string
  competency_ids: string[]
}

export interface KeyOut {
  id: string
  assessment_id: string
  version: number
  verified: boolean
  questions: QuestionOut[]
  created_at: string
}

export interface AssessmentCreate {
  id: string
  title: string
  description?: string | null
  template_id: string
  assessment_date: string
  category?: string | null
  class_id?: string | null
  due_at?: string | null
  answer_key: { id: string; questions: (KeyQuestion & { competency_ids: string[] })[] }
}

export interface AssessmentOut {
  id: string
  title: string
  description: string | null
  template_id: string
  assessment_date: string
  category: string | null
  archived: boolean
  class_id?: string | null
  due_at?: string | null
  answer_keys: KeyOut[]
  created_at: string
}

export interface ClientScore {
  automatic_score: string
  final_score: string
  possible_score: string
  items: ItemScore[]
}

export interface SubmissionCreate {
  id: string
  assessment_id: string
  answer_key_id: string
  student_label: string
  source: 'on_device' | 'gemini' | 'manual'
  answers: Answer[]
  submitted_at?: string | null
}

export interface OfflineSubmission {
  submission: SubmissionCreate
  adjustments: Adjustment[]
  teacher_approved: true
  local_approved_at: string
  client_score: ClientScore
}

export interface SubmissionOut {
  id: string
  assessment_id: string
  answer_key_id: string
  student_label: string
  source: string
  status: 'draft' | 'approved'
  revision: number
  answers: Answer[]
  score: Score & { answer_key_id: string; answer_key_version: number; key_verified: boolean }
  approved_at: string | null
  local_approved_at: string | null
  submitted_at?: string | null
  late?: boolean
  created_at: string
}

export interface UploadOut {
  server_id: string
  status: 'created' | 'already_uploaded'
  created_at: string
  answer_key_id: string
  answer_key_version: number
}

export interface OCROut {
  purpose: 'reference' | 'student' | 'notes'
  items: ExtractionItem[]
  text: string
  notes: string[]
  requires_teacher_review: true
}

export type MaterialKind = 'lesson_plan' | 'quiz' | 'rubric' | 'examples' | 'activity' | 'rewrite' | 'follow_up'

export interface QuizQuestion {
  number: number
  prompt: string
  options: string[]
  answer: string
  explanation: string
}

export interface RubricCriterion {
  criterion: string
  max_points: number
  descriptors: string[]
}

export interface MaterialContent {
  title: string
  sections: { heading: string; body: string }[]
  quiz_questions: QuizQuestion[]
  rubric_criteria: RubricCriterion[]
  rewritten_text: string | null
}

export interface Provenance {
  provider: 'google_gemini' | 'teacher'
  model: string | null
  generated_at: string
  prompt_version: string
  ai_generated: boolean
}

export interface MaterialOut {
  id: string
  kind: MaterialKind
  content: MaterialContent
  provenance: Provenance
  revision: number
  status: 'draft' | 'reviewed'
  created_at: string
  updated_at: string
}

export interface GenerateMaterial {
  kind: MaterialKind
  topic: string
  student_level: string
  objectives: string[]
  preferences: string
  source_text?: string
}

type Body = { json: unknown } | { form: FormData } | undefined

async function send<T>(method: string, path: string, body?: Body): Promise<T> {
  const config = getConfig()
  if (!config) throw new ApiError(0, 'not_configured', 'Online features are not configured in this build.')

  const attempt = async (token: string | null) => {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    let payload: BodyInit | undefined
    if (body && 'json' in body) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body.json)
    } else if (body && 'form' in body) {
      payload = body.form
    }
    try {
      return await fetch(`${config.apiBaseUrl}/v1${path}`, { method, headers, body: payload })
    } catch {
      throw new ApiError(0, 'network_error', 'Could not reach the GabAI server. Check your connection.')
    }
  }

  let response = await attempt(await accessToken())
  // A 401 usually means the access token expired mid-session: refresh once, then give up.
  if (response.status === 401) {
    const fresh = await refreshAccessToken()
    if (fresh) response = await attempt(fresh)
  }
  if (!response.ok) {
    let code = 'http_error'
    let message = `Request failed (${response.status})`
    let requestId: string | undefined
    try {
      const data = (await response.json()) as { error?: { code: string; message: string; request_id: string } }
      if (data.error) ({ code, message, request_id: requestId } = data.error)
    } catch {
      // Non-JSON error body (proxy, gateway); keep the generic message.
    }
    const retry = Number(response.headers.get('Retry-After'))
    throw new ApiError(response.status, code, message, requestId, Number.isFinite(retry) && retry > 0 ? retry : undefined)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export interface Listing<T> {
  items: T[]
  /** Server clock when the first page was read: the next sync's updated_since. */
  serverTime: string | null
}

/** Every page of a list, optionally only the records changed after `since`. */
/** GET that returns a file (the profile picture), or null when there is none. */
async function fetchBlob(path: string): Promise<Blob | null> {
  const config = getConfig()
  if (!config) return null
  const token = await accessToken()
  const response = await fetch(`${config.apiBaseUrl}/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null)
  if (!response) throw new ApiError(0, 'network_error', 'Could not reach the GabAI server. Check your connection.')
  if (response.status === 404) return null
  if (!response.ok) throw new ApiError(response.status, 'http_error', `Request failed (${response.status})`)
  return response.blob()
}

async function allPages<T>(path: string, since?: string | null, maxPages = 20): Promise<Listing<T>> {
  const items: T[] = []
  let serverTime: string | null = null
  const filter = since ? `&updated_since=${encodeURIComponent(since)}` : ''
  const join = path.includes('?') ? '&' : '?'
  for (let page = 0; page < maxPages; page++) {
    const result = await send<Page<T>>('GET', `${path}${join}limit=100&offset=${page * 100}${filter}`)
    if (page === 0) serverTime = result.server_time ?? null
    items.push(...result.items)
    if (!result.has_more) break
  }
  return { items, serverTime }
}

/** Requests that answer 204 No Content. */
async function sendEmpty(method: string, path: string, body?: Body): Promise<void> {
  await send<undefined>(method, path, body)
}

export const api = {
  me: () => send<ProfileOut>('GET', '/me'),
  updateMe: (body: ProfileEdit) => send<ProfileOut>('PUT', '/me', { json: body }),
  uploadAvatar: (image: Blob) => {
    const form = new FormData()
    form.append('file', image, 'avatar.jpg')
    return sendEmpty('PUT', '/me/avatar', { form })
  },
  deleteAvatar: () => sendEmpty('DELETE', '/me/avatar'),
  avatar: () => fetchBlob('/me/avatar'),
  preferences: () => send<PreferencesOut>('GET', '/me/preferences'),
  savePreferences: (body: PreferencesBody) => send<PreferencesOut>('PUT', '/me/preferences', { json: body }),
  listClasses: (since?: string | null) => allPages<ClassOut>('/classes', since),
  saveClass: (id: string, body: ClassBody) => send<ClassOut>('PUT', `/classes/${id}`, { json: body }),
  archiveClass: (id: string) => send<ClassOut>('DELETE', `/classes/${id}`),
  listEvents: (since?: string | null) => allPages<EventOut>('/events', since),
  saveEvent: (id: string, body: EventBody) => send<EventOut>('PUT', `/events/${id}`, { json: body }),
  deleteEvent: (id: string) => send<EventOut>('DELETE', `/events/${id}`),
  sendFeedback: (body: { message: string; app_version: string; platform: string }) =>
    send<{ id: string; created_at: string }>('POST', '/feedback', { json: body }),
  listAssessments: (since?: string | null) => allPages<AssessmentOut>('/assessments', since),
  uploadAssessment: (assessment: AssessmentCreate) =>
    send<UploadOut>('POST', '/uploads/assessments', { json: { assessment, key_teacher_verified: true } }),
  previewScore: (answerKeyId: string, answers: Answer[], adjustments: Adjustment[], clientScore: ClientScore) =>
    send<Score>('POST', '/scoring/preview', {
      json: { answer_key_id: answerKeyId, answers, adjustments, client_score: clientScore },
    }),
  uploadSubmission: (payload: OfflineSubmission) =>
    send<UploadOut>('POST', '/uploads/submissions', { json: payload }),
  listApprovedSubmissions: (since?: string | null) => allPages<SubmissionOut>('/submissions?status=approved', since),
  ocr: (purpose: 'reference' | 'student', image: Blob) => {
    const form = new FormData()
    form.append('file', image, `paper.${image.type === 'image/png' ? 'png' : 'jpg'}`)
    return send<OCROut>('POST', `/ocr/${purpose}`, { form })
  },
  generateMaterial: (payload: GenerateMaterial) => send<MaterialOut>('POST', '/materials/generate', { json: payload }),
  listMaterials: (since?: string | null) => allPages<MaterialOut>('/materials', since),
  editMaterial: (id: string, expectedRevision: number, content: MaterialContent) =>
    send<MaterialOut>('PATCH', `/materials/${id}`, { json: { expected_revision: expectedRevision, content } }),
  reviewMaterial: (id: string, expectedRevision: number) =>
    send<MaterialOut>('POST', `/materials/${id}/review`, { json: { confirmed: true, expected_revision: expectedRevision } }),
}

/** Public liveness check (no token), for About → server status. */
export async function serverHealth(): Promise<{ status: string; version?: string } | null> {
  const config = getConfig()
  if (!config) return null
  try {
    const response = await fetch(`${config.apiBaseUrl}/health`)
    return response.ok ? ((await response.json()) as { status: string; version?: string }) : null
  } catch {
    return null
  }
}

/** One plain sentence for a toast or inline error. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'Something went wrong.'
  switch (error.code) {
    case 'network_error':
      return 'You appear to be offline. Your work is saved on this device.'
    case 'not_configured':
      return error.message
    case 'mfa_required':
      return 'Finish two-step verification to use online features.'
    case 'invalid_token':
    case 'authentication_required':
      return 'Your session ended. Sign in again to go online.'
    case 'ai_not_configured':
      return 'The server has no AI model configured yet.'
    case 'ai_rate_limited':
    case 'ai_quota_exceeded':
    case 'ocr_busy':
      return `The AI service is busy. Try again${error.retryAfter ? ` in ${error.retryAfter} s` : ' shortly'}.`
    case 'ai_timeout':
      return 'The AI service took too long. Try again.'
    case 'ai_invalid_response':
    case 'ai_provider_error':
      return 'The AI service could not produce a usable draft. Try again.'
    case 'image_too_large':
    case 'unsupported_image':
    case 'invalid_image':
      return 'That image could not be used. Retake it as a clear JPEG or PNG photo.'
    case 'stale_revision':
      return 'This was changed elsewhere. Reload it before saving again.'
    case 'upload_conflict':
      return 'The server already has a different record with this ID.'
    case 'unknown_class':
      return 'Its section has not reached the server yet. It will upload after the section does.'
    case 'feedback_limit':
      return "That's a lot of feedback today. Thank you! Try again tomorrow."
    case 'too_many_classes':
      return 'You can keep up to 60 active sections. Remove one you no longer teach.'
    default:
      return error.message
  }
}
