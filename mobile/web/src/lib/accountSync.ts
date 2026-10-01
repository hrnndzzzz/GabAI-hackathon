import type { AssessmentOut, ClassOut, EventOut, MaterialOut, PreferencesBody, PreferencesOut, ProfileOut, SubmissionOut } from './api'
import { defaultAvatar, PATTERNS, type PatternId } from './avatar'
import { classFromLabel, classLabel, type TeacherClass } from './classes'
import { materialToDraft } from './materials'
import type { ShortcutId } from './settings'
import { assessmentFromServer, classFromServer, eventFromServer, submissionFromServer } from './sync'
import { newId, type LocalAssessment, type SavedModule, type TeacherProfile, type Workspace } from './workspace'

// How a download from the server is folded into the phone's workspace. Anything edited on the
// phone and not yet uploaded (workspace.pending) wins; everything else follows the server.

/** Find the class a label names, creating it (from the label) when the teacher has none yet. */
export function classForLabel(classes: TeacherClass[], label: string): { classes: TeacherClass[]; id: string } {
  const found = classes.find((c) => classLabel(c) === label)
  if (found) return { classes, id: found.id }
  const created = classFromLabel(label, newId())
  return { classes: [...classes, created], id: created.id }
}

export interface Download {
  me: ProfileOut
  /** A newly downloaded profile picture (data URL), null when the server has none, undefined to keep. */
  photo: string | null | undefined
  /** This sync uploaded the picture, so the server's copy is the phone's. */
  uploadedAvatar: boolean
  classes: ClassOut[]
  events: EventOut[]
  assessments: AssessmentOut[]
  submissions: SubmissionOut[]
  materials: MaterialOut[]
  serverTime: string | null
}

function profileFromServer(me: ProfileOut, local: TeacherProfile | null, photo: string | null | undefined): TeacherProfile | null {
  if (!me.full_name) return local
  const avatar = me.avatar
  const keptPhoto = photo !== undefined ? photo : (local?.avatar.photo ?? null)
  const pattern = PATTERNS.some((p) => p.id === avatar?.pattern) ? (avatar?.pattern as PatternId) : undefined
  return {
    fullName: me.full_name,
    school: me.school_name ?? '',
    avatar: {
      // A photo style without a photo on this phone falls back to initials until it downloads.
      style: avatar?.style === 'photo' && !keptPhoto ? 'initials' : (avatar?.style ?? 'initials'),
      color: avatar?.color ?? local?.avatar.color ?? defaultAvatar(me.full_name).color,
      pattern,
      photo: keptPhoto,
    },
  }
}

export function mergeDownload(w: Workspace, d: Download): Workspace {
  const pending = w.pending

  const profile = pending.profile ? w.profile : profileFromServer(d.me, w.profile, pending.avatar ? undefined : d.photo)
  const avatarSyncedISO = d.uploadedAvatar || d.photo !== undefined ? (d.me.avatar?.photo_updated_at ?? null) : w.avatarSyncedISO

  let classes = w.classes
  for (const c of d.classes) {
    if (pending.classes.includes(c.id) || pending.archivedClasses.includes(c.id)) continue
    if (c.archived) classes = classes.filter((x) => x.id !== c.id)
    else if (classes.some((x) => x.id === c.id)) classes = classes.map((x) => (x.id === c.id ? classFromServer(c) : x))
    else classes = [...classes, classFromServer(c)]
  }

  let events = w.events
  for (const e of d.events) {
    if (pending.events.includes(e.id) || pending.deletedEvents.includes(e.id)) continue
    if (e.deleted_at) events = events.filter((x) => x.id !== e.id)
    else if (events.some((x) => x.id === e.id)) events = events.map((x) => (x.id === e.id ? eventFromServer(e) : x))
    else events = [...events, eventFromServer(e)]
  }

  // Assessments already on the phone take the server's class and due date (edited elsewhere);
  // new ones are added, linked to a section by class_id, or by label for older records.
  const byId = new Map(d.assessments.map((a) => [a.id, a]))
  let assessments: LocalAssessment[] = w.assessments.map((a) => {
    const server = byId.get(a.id)
    if (!server || (a.sync !== 'synced' && a.origin !== 'server')) return a
    return { ...a, title: server.title, classId: server.class_id ?? a.classId, dueISO: server.due_at ?? null }
  })
  const known = new Set(w.assessments.map((a) => a.id))
  for (const server of d.assessments) {
    if (server.archived || known.has(server.id)) continue
    const local = assessmentFromServer(server)
    if (!local) continue
    if (!local.classId || !classes.some((c) => c.id === local.classId)) {
      const link = classForLabel(classes, local.classLabel)
      classes = link.classes
      local.classId = link.id
    }
    assessments = [...assessments, local]
  }
  // Keep labels in step with the sections (renamed on another device, or linked just now).
  const label = new Map(classes.map((c) => [c.id, classLabel(c)]))
  assessments = assessments.map((a) => (a.classId && label.has(a.classId) ? { ...a, classLabel: label.get(a.classId)! } : a))

  const knownSubs = new Set(w.submissions.map((s) => s.id))
  const added = d.submissions.filter((s) => !knownSubs.has(s.id)).map((s) => submissionFromServer(s, assessments))
  const submissions = [...w.submissions, ...added]
    .map((s) => (s.classId && label.has(s.classId) ? { ...s, classLabel: label.get(s.classId)! } : s))
    .sort((a, b) => Date.parse(b.approvedISO) - Date.parse(a.approvedISO))

  const modules = new Map<string, SavedModule>(w.modules.map((m) => [m.id, m]))
  for (const material of d.materials) {
    const local = modules.get(material.id)
    // Keep unsaved local edits; otherwise take the server's current revision.
    if (local?.draft.dirty) continue
    modules.set(material.id, { id: material.id, draft: materialToDraft(material, local?.draft), savedISO: material.updated_at })
  }

  return {
    ...w,
    profile,
    displayName: profile?.fullName || d.me.display_name || w.displayName,
    avatarSyncedISO,
    classes,
    events,
    assessments,
    submissions,
    modules: [...modules.values()].sort((a, b) => Date.parse(b.savedISO) - Date.parse(a.savedISO)),
    serverTime: d.serverTime ?? w.serverTime,
    lastSyncedISO: new Date().toISOString(),
  }
}

/** The earliest server clock among parallel listings, so nothing changed between them is missed. */
export function earliest(times: (string | null)[]): string | null {
  const known = times.filter((t): t is string => !!t).sort((a, b) => Date.parse(a) - Date.parse(b))
  return known[0] ?? null
}

interface DeviceSettings {
  theme: 'light' | 'dark' | 'system'
  reduceMotion: boolean
  paperSize: 'A4' | 'Letter'
  defaultFormat: 'pdf' | 'markdown' | 'csv'
  dock: ShortcutId[]
  notify: Record<'urgent' | 'sync' | 'timer' | 'schedule' | 'tips', boolean>
}

export function preferencesBody(s: DeviceSettings): PreferencesBody {
  return { theme: s.theme, reduce_motion: s.reduceMotion, paper_size: s.paperSize, default_format: s.defaultFormat, dock: s.dock, notify: s.notify }
}

/** Settings from the account, for a phone signing in for the first time. */
export function settingsFromPreferences(p: PreferencesOut): Partial<DeviceSettings> {
  const out: Partial<DeviceSettings> = {}
  if (p.theme) out.theme = p.theme
  if (p.reduce_motion !== undefined && p.reduce_motion !== null) out.reduceMotion = p.reduce_motion
  if (p.paper_size) out.paperSize = p.paper_size
  if (p.default_format) out.defaultFormat = p.default_format
  if (p.dock?.length) out.dock = p.dock as ShortcutId[]
  if (p.notify) out.notify = { urgent: true, sync: true, timer: true, schedule: true, tips: true, ...p.notify }
  return out
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the picture'))
    reader.readAsDataURL(blob)
  })
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob()
}
