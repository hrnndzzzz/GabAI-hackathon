// Demo workspace: one fictional teacher, three class sections and three pending
// assessments (one urgent). Nothing here is uploaded; demo mode never goes online.

import { AVATAR_COLORS } from './avatar'
import type { CalendarEvent } from './calendar'
import { classLabel, type TeacherClass } from './classes'
import type { KeyQuestion } from './scoring'
import { localIsoWithOffset, type LocalAssessment, type RecordRow, type TeacherProfile } from './workspace'

export const DEMO_TEACHER = {
  firstName: 'Elena',
  lastName: 'Santos',
  display: 'Teacher Elena',
  email: 'elena.santos@gabai.edu',
  initials: 'ES',
  term: 'Term 2',
  ay: 'AY 2024-2025',
}

export const DEMO_PROFILE: TeacherProfile = {
  fullName: 'Elena Santos',
  school: 'GabAI Demo School',
  avatar: { style: 'initials', color: AVATAR_COLORS[0], photo: null },
}

const SAMPAGUITA = ['Marcus Chen', 'Andrea Villanueva', 'Joshua Ramos', 'Bea Dizon', 'Paolo Garcia', 'Kristine Lim']
const NARRA = [
  'Gabriel Santos',
  'Sofia Reyes',
  'Miguel Cruz',
  'Isabella Bautista',
  'Rafael Mendoza',
  'Camille Aquino',
  'Nathan Flores',
  'Bianca Torres',
  'Elijah Navarro',
  'Patricia Castillo',
  'Daniel Uy',
  'Angela Pascual',
]
const MOLAVE = ['Carlo Domingo', 'Jasmine Tan', 'Luis Fernandez', 'Maria Santiago', 'Kevin Lopez', 'Nicole Herrera', 'Adrian Valdez', 'Trisha Morales', 'Ryan Sy']

// Rosters: the papers still waiting in each demo assessment, plus students with earlier results
// and a few who have taken nothing yet (they show up under "Haven't taken").
export const DEMO_CLASSES: TeacherClass[] = [
  {
    id: 'demo-g4-rosal',
    level: 'elementary',
    grade: 4,
    section: 'Rosal',
    subject: 'Mathematics',
    students: ['Aira Mendoza', 'Bryan Dela Rosa', 'Carla Javier', 'Dino Reyes', 'Ella Marquez', 'Franco Uy', 'Gia Santos', 'Hiro Tan'],
  },
  {
    id: 'demo-g9-sampaguita',
    level: 'highschool',
    grade: 9,
    section: 'Sampaguita',
    subject: 'Biology',
    students: [...SAMPAGUITA, 'Hannah Lee', 'Jerome Aguilar', 'Lara Gomez', 'Noel Bautista', 'Trina Ocampo'],
  },
  {
    id: 'demo-g9-narra',
    level: 'highschool',
    grade: 9,
    section: 'Narra',
    subject: 'Biology',
    students: [...NARRA, 'Vince Ocampo', 'Mika Salazar', 'Sean Robles'],
  },
  {
    id: 'demo-g10-molave',
    level: 'highschool',
    grade: 10,
    section: 'Molave',
    subject: 'Chemistry',
    students: [...MOLAVE, 'Ella Mercado', 'Franco Lim', 'Rina Dela Cruz'],
  },
  {
    id: 'demo-y1-bsed',
    level: 'college',
    grade: 1,
    section: 'BSEd 1-A',
    subject: 'General Biology',
    students: ['Alyssa Cruz', 'Benjie Ramos', 'Celine Ong', 'Darren Lim', 'Erika Valdez', 'Francis Go'],
  },
]

const byId = (id: string) => DEMO_CLASSES.find((c) => c.id === id)!

/** Today (or a weekday ahead) at a local clock time, as a timezone-aware ISO string. */
function at(daysFromNow: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hour, minute, 0, 0)
  return localIsoWithOffset(d)
}

function nextWeekday(day: number): number {
  const diff = (day - new Date().getDay() + 7) % 7
  return diff === 0 ? 7 : diff
}

function buildQuestions(mc: string, trueFalse: string[], tfPoints = '1.00'): KeyQuestion[] {
  const letters = mc.replace(/\s/g, '').split('')
  const questions: KeyQuestion[] = letters.map((answer, i) => ({
    number: i + 1,
    kind: 'multiple_choice',
    points: '1.00',
    choices: ['A', 'B', 'C', 'D'],
    correct_answer: answer,
    alternatives: [],
  }))
  trueFalse.forEach((answer, i) =>
    questions.push({
      number: letters.length + i + 1,
      kind: 'true_false',
      points: tfPoints,
      choices: [],
      correct_answer: answer,
      alternatives: [],
    }),
  )
  return questions
}

function topicRanges(ranges: [string, number][]): Record<number, string> {
  const topics: Record<number, string> = {}
  let q = 1
  for (const [topic, count] of ranges) for (let i = 0; i < count; i++) topics[q++] = topic
  return topics
}

const BIO_TOPICS = topicRanges([
  ['cell structure', 5],
  ['the light reactions', 5],
  ['the Calvin cycle', 5],
  ['cellular respiration', 5],
  ['energy flow concepts', 5],
])

const CREATED = '2025-01-06T08:00:00+08:00'

export const DEMO_ASSESSMENTS: LocalAssessment[] = [
  {
    id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e01',
    title: 'Bio Midterm',
    classId: 'demo-g9-sampaguita',
    classLabel: classLabel(byId('demo-g9-sampaguita')),
    assessmentDate: '2025-01-15',
    dueISO: at(0, 17),
    key: {
      id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e11',
      version: 1,
      verified: true,
      questions: buildQuestions('BCADB DBACD ABDCA CDBAB', ['TRUE', 'FALSE', 'TRUE', 'TRUE', 'FALSE']),
    },
    topics: BIO_TOPICS,
    roster: SAMPAGUITA,
    urgent: true,
    origin: 'demo',
    sync: 'local',
    createdISO: CREATED,
  },
  {
    id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e02',
    title: 'Bio Midterm',
    classId: 'demo-g9-narra',
    classLabel: classLabel(byId('demo-g9-narra')),
    assessmentDate: '2025-01-17',
    dueISO: at(nextWeekday(5), 17),
    key: {
      id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e12',
      version: 1,
      verified: true,
      questions: buildQuestions('CADBA BDCAC DABDC BACDA', ['FALSE', 'TRUE', 'TRUE', 'FALSE', 'TRUE']),
    },
    topics: BIO_TOPICS,
    roster: NARRA,
    urgent: false,
    origin: 'demo',
    sync: 'local',
    createdISO: CREATED,
  },
  {
    id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e03',
    title: 'Chem Quiz 3',
    classId: 'demo-g10-molave',
    classLabel: classLabel(byId('demo-g10-molave')),
    assessmentDate: '2025-01-20',
    dueISO: at(nextWeekday(1), 17),
    key: {
      id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e13',
      version: 1,
      verified: true,
      questions: buildQuestions('BADC CBAD DACB', ['TRUE', 'FALSE', 'TRUE'], '2.00'),
    },
    topics: topicRanges([
      ['the mole concept', 4],
      ['molar mass', 4],
      ['mole ratios', 4],
      ['limiting reactants', 3],
    ]),
    roster: MOLAVE,
    urgent: false,
    origin: 'demo',
    sync: 'local',
    createdISO: CREATED,
  },
]

// Late papers once a demo roster is fully graded.
export const LATE_PAPERS = ['Renz Villareal', 'Joy Soriano', 'Mark Tolentino', 'Cris Alvarez']

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(15, 10 + days * 7, 0, 0)
  return d.toISOString()
}

// [student, class, assessment, earned, possible, days ago, missed, late]
const HISTORY: [string, string, string, number, number, number, number[], boolean][] = [
  ['Hannah Lee', 'demo-g9-sampaguita', 'Bio Quiz 4', 19, 20, 1, [7], false],
  ['Jerome Aguilar', 'demo-g9-sampaguita', 'Bio Quiz 4', 16, 20, 1, [3, 9, 14, 18], true],
  ['Lara Gomez', 'demo-g9-sampaguita', 'Bio Quiz 4', 18, 20, 1, [11, 16], false],
  ['Vince Ocampo', 'demo-g9-narra', 'Bio Quiz 4', 15, 20, 2, [2, 6, 8, 13, 19], false],
  ['Mika Salazar', 'demo-g9-narra', 'Bio Quiz 4', 20, 20, 2, [], false],
  ['Sean Robles', 'demo-g9-narra', 'Bio Quiz 4', 17, 20, 2, [4, 10, 15], true],
  ['Ella Mercado', 'demo-g10-molave', 'Chem Quiz 2', 16, 18, 4, [9], false],
  ['Franco Lim', 'demo-g10-molave', 'Chem Quiz 2', 13, 18, 4, [2, 7, 11, 13], true],
  ['Rina Dela Cruz', 'demo-g10-molave', 'Chem Quiz 2', 15, 18, 4, [6, 14], false],
  ['Hannah Lee', 'demo-g9-sampaguita', 'Lab Practical 2', 23, 25, 9, [12, 21], false],
  ['Lara Gomez', 'demo-g9-sampaguita', 'Lab Practical 2', 21, 25, 9, [5, 12, 17, 24], false],
  ['Mika Salazar', 'demo-g9-narra', 'Lab Practical 2', 24, 25, 11, [19], false],
  ['Ella Mercado', 'demo-g10-molave', 'Chem Quiz 1', 17, 18, 18, [4], false],
  ['Franco Lim', 'demo-g10-molave', 'Chem Quiz 1', 14, 18, 18, [3, 8, 15], false],
  ['Aira Mendoza', 'demo-g4-rosal', 'Fractions Quiz', 9, 10, 3, [6], false],
  ['Bryan Dela Rosa', 'demo-g4-rosal', 'Fractions Quiz', 7, 10, 3, [2, 5, 9], false],
  ['Carla Javier', 'demo-g4-rosal', 'Fractions Quiz', 10, 10, 3, [], false],
  ['Dino Reyes', 'demo-g4-rosal', 'Fractions Quiz', 6, 10, 2, [1, 4, 7, 8], true],
  ['Ella Marquez', 'demo-g4-rosal', 'Fractions Quiz', 8, 10, 3, [3, 10], false],
  ['Alyssa Cruz', 'demo-y1-bsed', 'Lab Exam 1', 46, 50, 6, [8, 31], false],
  ['Benjie Ramos', 'demo-y1-bsed', 'Lab Exam 1', 38, 50, 6, [2, 9, 14, 22, 30, 41], false],
  ['Celine Ong', 'demo-y1-bsed', 'Lab Exam 1', 42, 50, 5, [5, 18, 27, 33], true],
  ['Darren Lim', 'demo-y1-bsed', 'Lab Exam 1', 33, 50, 6, [1, 4, 9, 12, 19, 25, 28, 37, 44], false],
]

function seeded(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

// The rest of each class list for those earlier assessments, so section averages and rankings look
// like a real class: deterministic scores, a few late papers, and one student per test who has not taken it.
function fillHistory(): typeof HISTORY {
  const rows = [...HISTORY]
  for (const c of DEMO_CLASSES) {
    const titles = [...new Set(HISTORY.filter((h) => h[1] === c.id).map((h) => h[2]))]
    titles.forEach((title, t) => {
      const sample = HISTORY.find((h) => h[1] === c.id && h[2] === title)!
      const possible = sample[4]
      c.students.forEach((student, i) => {
        if (HISTORY.some((h) => h[0] === student && h[1] === c.id && h[2] === title)) return
        if ((i + t * 3) % c.students.length === c.students.length - 1) return
        const h = seeded(`${student}|${title}`)
        const lost = h % Math.max(2, Math.ceil(possible * 0.4))
        const missed = Array.from({ length: lost }, (_, k) => 1 + ((h >>> (k + 3)) % possible) )
        rows.push([student, c.id, title, possible - lost, possible, sample[5], [...new Set(missed)].sort((x, y) => x - y), h % 11 === 0])
      })
    })
  }
  return rows
}

/** Earlier, already-approved demo results shown in Records. */
export const DEMO_HISTORY: RecordRow[] = fillHistory().map(([student, classId, assessment, earned, possible, days, missed, late], i) => ({
  id: `demo-history-${i}`,
  student,
  classId,
  classLabel: classLabel(byId(classId)),
  assessmentId: null,
  assessment,
  finalScore: `${earned}.00`,
  possibleScore: `${possible}.00`,
  percent: (earned / possible) * 100,
  dateISO: daysAgo(days),
  missed,
  feedback: '',
  sync: 'local',
  late,
}))

export function demoEvents(): CalendarEvent[] {
  const event = (
    id: string,
    title: string,
    type: CalendarEvent['type'],
    startISO: string,
    durationMin: number,
    extra: Partial<CalendarEvent> = {},
  ): CalendarEvent => ({ id, title, type, startISO, durationMin, allDay: false, classId: null, assessmentId: null, notes: '', ...extra })
  return [
    event('demo-ev-1', 'Bio Midterm', 'exam', at(0, 13), 60, { classId: 'demo-g9-sampaguita', assessmentId: DEMO_ASSESSMENTS[0].id }),
    event('demo-ev-2', 'Science department meeting', 'meeting', at(0, 15, 30), 45),
    event('demo-ev-3', 'Fractions: adding dissimilar fractions', 'class', at(1, 8), 45, { classId: 'demo-g4-rosal' }),
    event('demo-ev-4', 'Parent conference: Kristine Lim', 'reminder', at(1, 10), 30, { classId: 'demo-g9-sampaguita' }),
    event('demo-ev-5', 'Chem Quiz 3', 'quiz', at(nextWeekday(1), 9), 40, { classId: 'demo-g10-molave', assessmentId: DEMO_ASSESSMENTS[2].id }),
    event('demo-ev-6', 'Submit Term 2 grades', 'deadline', at(5, 0), 0, { allDay: true }),
  ]
}
