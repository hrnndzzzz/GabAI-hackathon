import { describe, expect, it } from 'vitest'
import type { AssessmentOut, ClassOut, EventOut, ProfileOut } from './api'
import { earliest, mergeDownload, settingsFromPreferences, type Download } from './accountSync'
import { emptyWorkspace, noPending, type Workspace } from './workspace'

const me: ProfileOut = { id: 'u1', display_name: 'Teacher', mfa_required: true }

function download(parts: Partial<Download> = {}): Download {
  return { me, photo: undefined, uploadedAvatar: false, classes: [], events: [], assessments: [], submissions: [], materials: [], serverTime: null, ...parts }
}

const serverClass = (id: string, changes: Partial<ClassOut> = {}): ClassOut => ({
  id,
  level: 'highschool',
  grade: 9,
  section: 'Narra',
  subject: 'Biology',
  students: ['Ana Reyes'],
  student_ids: ['s1'],
  archived: false,
  revision: 2,
  updated_at: '2026-10-02T00:00:00Z',
  ...changes,
})

const serverEvent = (id: string, changes: Partial<EventOut> = {}): EventOut => ({
  id,
  title: 'Bio Midterm',
  type: 'exam',
  starts_at: '2026-10-05T05:00:00Z',
  duration_min: 60,
  all_day: false,
  class_id: null,
  assessment_id: null,
  notes: '',
  revision: 1,
  deleted_at: null,
  updated_at: '2026-10-02T00:00:00Z',
  ...changes,
})

const serverAssessment = (id: string, changes: Partial<AssessmentOut> = {}): AssessmentOut => ({
  id,
  title: 'Quiz 1',
  description: null,
  template_id: 'gabai-sheet-v1',
  assessment_date: '2026-09-15',
  category: 'G9 Bio · Narra',
  archived: false,
  answer_keys: [{ id: `${id}-k`, assessment_id: id, version: 1, verified: true, questions: [], created_at: '2026-09-15T00:00:00Z' }],
  created_at: '2026-09-15T00:00:00Z',
  ...changes,
})

function workspace(changes: Partial<Workspace> = {}): Workspace {
  return { ...emptyWorkspace('Teacher'), ...changes }
}

describe('mergeDownload', () => {
  it('adds and updates sections from the server, and drops archived ones', () => {
    const w = workspace({
      classes: [
        { id: 'c1', level: 'highschool', grade: 9, section: 'Old name', subject: 'Biology', students: [] },
        { id: 'c2', level: 'highschool', grade: 9, section: 'Gone', subject: 'Biology', students: [] },
      ],
    })
    const out = mergeDownload(w, download({ classes: [serverClass('c1'), serverClass('c2', { archived: true }), serverClass('c3', { section: 'Molave' })] }))
    expect(out.classes.map((c) => [c.id, c.section])).toEqual([['c1', 'Narra'], ['c3', 'Molave']])
  })

  it('keeps sections and schedule items edited on this phone until they upload', () => {
    const w = workspace({
      classes: [{ id: 'c1', level: 'highschool', grade: 9, section: 'Mine', subject: 'Biology', students: ['New Student'] }],
      events: [{ id: 'e1', title: 'Moved exam', type: 'exam', startISO: '2026-10-06T05:00:00Z', durationMin: 90, allDay: false, classId: null, assessmentId: null, notes: '' }],
      pending: { ...noPending(), classes: ['c1'], events: ['e1'] },
    })
    const out = mergeDownload(w, download({ classes: [serverClass('c1')], events: [serverEvent('e1')] }))
    expect(out.classes[0].section).toBe('Mine')
    expect(out.events[0].title).toBe('Moved exam')
  })

  it('removes schedule items deleted on another device', () => {
    const w = workspace({ events: [{ id: 'e1', title: 'x', type: 'quiz', startISO: '2026-10-06T05:00:00Z', durationMin: 30, allDay: false, classId: null, assessmentId: null, notes: '' }] })
    const out = mergeDownload(w, download({ events: [serverEvent('e1', { deleted_at: '2026-10-02T01:00:00Z' }), serverEvent('e2')] }))
    expect(out.events.map((e) => e.id)).toEqual(['e2'])
  })

  it('links new assessments by class_id, or by label for older ones', () => {
    const w = workspace({ classes: [{ id: 'c1', level: 'highschool', grade: 9, section: 'Narra', subject: 'Biology', students: [] }] })
    const out = mergeDownload(
      w,
      download({
        assessments: [
          serverAssessment('a1', { class_id: 'c1', due_at: '2026-09-15T09:00:00Z', category: 'stale label' }),
          serverAssessment('a2', { category: 'G10 Chem · Molave' }),
          serverAssessment('a3', { archived: true }),
        ],
      }),
    )
    const a1 = out.assessments.find((a) => a.id === 'a1')!
    expect(a1.classId).toBe('c1')
    expect(a1.dueISO).toBe('2026-09-15T09:00:00Z')
    expect(a1.classLabel).toBe('G9 Bio · Narra')
    const a2 = out.assessments.find((a) => a.id === 'a2')!
    expect(out.classes.find((c) => c.id === a2.classId)?.section).toBe('Molave')
    expect(out.assessments.some((a) => a.id === 'a3')).toBe(false)
  })

  it('applies the account profile unless it was edited here', () => {
    const server: ProfileOut = { ...me, full_name: 'Elena Santos', school_name: 'Fictional School', avatar: { style: 'pattern', color: '#6BCB77', pattern: 'waves', has_photo: false, photo_updated_at: null } }
    const fresh = mergeDownload(workspace(), download({ me: server }))
    expect(fresh.profile).toMatchObject({ fullName: 'Elena Santos', school: 'Fictional School', avatar: { style: 'pattern', pattern: 'waves', color: '#6BCB77' } })
    expect(fresh.displayName).toBe('Elena Santos')
    const local = { fullName: 'Typed here', school: 'Mine', avatar: { style: 'initials' as const, color: '#FFD93D', photo: null } }
    const kept = mergeDownload(workspace({ profile: local, pending: { ...noPending(), profile: true } }), download({ me: server }))
    expect(kept.profile).toEqual(local)
  })

  it('stores a downloaded picture and remembers which one it is', () => {
    const server: ProfileOut = { ...me, full_name: 'Elena', avatar: { style: 'photo', color: null, pattern: null, has_photo: true, photo_updated_at: '2026-10-02T02:00:00Z' } }
    const out = mergeDownload(workspace(), download({ me: server, photo: 'data:image/jpeg;base64,AAAA' }))
    expect(out.profile?.avatar).toMatchObject({ style: 'photo', photo: 'data:image/jpeg;base64,AAAA' })
    expect(out.avatarSyncedISO).toBe('2026-10-02T02:00:00Z')
  })

  it('keeps the previous server time when a download has none', () => {
    expect(mergeDownload(workspace({ serverTime: 'T1' }), download()).serverTime).toBe('T1')
    expect(mergeDownload(workspace({ serverTime: 'T1' }), download({ serverTime: 'T2' })).serverTime).toBe('T2')
  })
})

describe('sync helpers', () => {
  it('uses the earliest server clock among listings', () => {
    expect(earliest(['2026-10-02T00:00:02Z', null, '2026-10-02T00:00:01Z'])).toBe('2026-10-02T00:00:01Z')
    expect(earliest([null])).toBeNull()
  })

  it('turns account settings into phone settings, filling missing notification switches', () => {
    expect(settingsFromPreferences({ updated_at: 'x', theme: 'dark', notify: { tips: false }, dock: ['scan'] })).toEqual({
      theme: 'dark',
      dock: ['scan'],
      notify: { urgent: true, sync: true, timer: true, schedule: true, tips: false },
    })
  })
})
