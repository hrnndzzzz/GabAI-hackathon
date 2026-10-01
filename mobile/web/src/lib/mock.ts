// Demo workspace: one fictional teacher, three class sections and three pending
// assessments (one urgent). Nothing here is uploaded; demo mode never goes online.

import type { KeyQuestion } from './scoring'
import type { LocalAssessment, RecordRow } from './workspace'

export const DEMO_TEACHER = {
  firstName: 'Elena',
  lastName: 'Santos',
  display: 'Teacher Elena',
  email: 'elena.santos@gabai.edu',
  initials: 'ES',
  term: 'Term 2',
  ay: 'AY 2024-2025',
}

export interface ClassSection {
  label: string
  short: string
  section: string
  grade: number
  subject: string
  students: number
  files: number
}

export const DEMO_CLASSES: ClassSection[] = [
  { label: 'G9 Bio · Sampaguita', short: 'G9 Bio', section: 'Sampaguita', grade: 9, subject: 'Biology', students: 38, files: 52 },
  { label: 'G9 Bio · Narra', short: 'G9 Bio', section: 'Narra', grade: 9, subject: 'Biology', students: 40, files: 47 },
  { label: 'G10 Chem · Molave', short: 'G10 Chem', section: 'Molave', grade: 10, subject: 'Chemistry', students: 41, files: 43 },
]

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
    classLabel: 'G9 Bio · Sampaguita',
    assessmentDate: '2025-01-15',
    key: {
      id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e11',
      version: 1,
      verified: true,
      questions: buildQuestions('BCADB DBACD ABDCA CDBAB', ['TRUE', 'FALSE', 'TRUE', 'TRUE', 'FALSE']),
    },
    topics: BIO_TOPICS,
    roster: ['Marcus Chen', 'Andrea Villanueva', 'Joshua Ramos', 'Bea Dizon', 'Paolo Garcia', 'Kristine Lim'],
    urgent: true,
    due: 'Due today, 5:00 PM',
    origin: 'demo',
    sync: 'local',
    createdISO: CREATED,
  },
  {
    id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e02',
    title: 'Bio Midterm',
    classLabel: 'G9 Bio · Narra',
    assessmentDate: '2025-01-17',
    key: {
      id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e12',
      version: 1,
      verified: true,
      questions: buildQuestions('CADBA BDCAC DABDC BACDA', ['FALSE', 'TRUE', 'TRUE', 'FALSE', 'TRUE']),
    },
    topics: BIO_TOPICS,
    roster: [
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
    ],
    urgent: false,
    due: 'Due Friday',
    origin: 'demo',
    sync: 'local',
    createdISO: CREATED,
  },
  {
    id: '6f1d3a52-2b8c-4c1e-9a77-1a2b3c4d5e03',
    title: 'Chem Quiz 3',
    classLabel: 'G10 Chem · Molave',
    assessmentDate: '2025-01-20',
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
    roster: [
      'Carlo Domingo',
      'Jasmine Tan',
      'Luis Fernandez',
      'Maria Santiago',
      'Kevin Lopez',
      'Nicole Herrera',
      'Adrian Valdez',
      'Trisha Morales',
      'Ryan Sy',
    ],
    urgent: false,
    due: 'Due Monday',
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

const HISTORY: [string, string, string, number, number, number, number[]][] = [
  ['Hannah Lee', 'G9 Bio · Sampaguita', 'Bio Quiz 4', 19, 20, 1, [7]],
  ['Jerome Aguilar', 'G9 Bio · Sampaguita', 'Bio Quiz 4', 16, 20, 1, [3, 9, 14, 18]],
  ['Lara Gomez', 'G9 Bio · Sampaguita', 'Bio Quiz 4', 18, 20, 1, [11, 16]],
  ['Vince Ocampo', 'G9 Bio · Narra', 'Bio Quiz 4', 15, 20, 2, [2, 6, 8, 13, 19]],
  ['Mika Salazar', 'G9 Bio · Narra', 'Bio Quiz 4', 20, 20, 2, []],
  ['Sean Robles', 'G9 Bio · Narra', 'Bio Quiz 4', 17, 20, 2, [4, 10, 15]],
  ['Ella Mercado', 'G10 Chem · Molave', 'Chem Quiz 2', 16, 18, 4, [9]],
  ['Franco Lim', 'G10 Chem · Molave', 'Chem Quiz 2', 13, 18, 4, [2, 7, 11, 13]],
  ['Rina Dela Cruz', 'G10 Chem · Molave', 'Chem Quiz 2', 15, 18, 4, [6, 14]],
  ['Hannah Lee', 'G9 Bio · Sampaguita', 'Lab Practical 2', 23, 25, 9, [12, 21]],
  ['Lara Gomez', 'G9 Bio · Sampaguita', 'Lab Practical 2', 21, 25, 9, [5, 12, 17, 24]],
  ['Mika Salazar', 'G9 Bio · Narra', 'Lab Practical 2', 24, 25, 11, [19]],
  ['Ella Mercado', 'G10 Chem · Molave', 'Chem Quiz 1', 17, 18, 18, [4]],
  ['Franco Lim', 'G10 Chem · Molave', 'Chem Quiz 1', 14, 18, 18, [3, 8, 15]],
]

/** Earlier, already-approved demo results shown in Records. */
export const DEMO_HISTORY: RecordRow[] = HISTORY.map(([student, classLabel, assessment, earned, possible, days, missed], i) => ({
  id: `demo-history-${i}`,
  student,
  classLabel,
  assessment,
  finalScore: `${earned}.00`,
  possibleScore: `${possible}.00`,
  percent: (earned / possible) * 100,
  dateISO: daysAgo(days),
  missed,
  feedback: '',
  sync: 'local',
}))
