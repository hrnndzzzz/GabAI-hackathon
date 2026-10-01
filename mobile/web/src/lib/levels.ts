import type { Tone } from '../components/ui'

// School levels for the AI Assistant. Each level has its own grade stops, subject
// list (which also shifts by grade band) and colour, so the flow re-themes itself.

export type Level = 'elementary' | 'highschool' | 'college'

export interface GradeStop {
  value: number
  tick: string
}

export interface LevelInfo {
  label: string
  range: string
  tone: Tone
  stops: GradeStop[]
}

export const LEVELS: Record<Level, LevelInfo> = {
  elementary: {
    label: 'Elementary',
    range: 'Kinder – G6',
    tone: 'yellow',
    stops: [0, 1, 2, 3, 4, 5, 6].map((g) => ({ value: g, tick: g === 0 ? 'K' : String(g) })),
  },
  highschool: {
    label: 'High School',
    range: 'Grade 7 – 12',
    tone: 'green',
    stops: [7, 8, 9, 10, 11, 12].map((g) => ({ value: g, tick: String(g) })),
  },
  college: {
    label: 'College',
    range: '1st – 4th yr',
    tone: 'blue',
    stops: [1, 2, 3, 4].map((g) => ({ value: g, tick: ordinal(g) })),
  },
}

export const LEVEL_ORDER: Level[] = ['elementary', 'highschool', 'college']

function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
}

/** Older saved drafts predate levels; their grades were all high school. */
export function levelOf(draft: { level?: Level }): Level {
  return draft.level ?? 'highschool'
}

export function gradeLabel(level: Level, grade: number): string {
  if (level === 'college') return `${ordinal(grade)} Year College`
  if (grade === 0) return 'Kindergarten'
  return `Grade ${grade}`
}

/** Compact form for badges and list rows: K, G3, G11, Y2. */
export function gradeShort(level: Level, grade: number): string {
  if (level === 'college') return `Y${grade}`
  return grade === 0 ? 'K' : `G${grade}`
}

/** Who the draft is written for, as a sentence subject. */
export function learners(level: Level, grade: number): string {
  if (level === 'college') return `${ordinal(grade)}-year college students`
  if (grade === 0) return 'Kindergarten learners'
  return `Grade ${grade} learners`
}

/** The backend's free-text student_level. */
export function studentLevel(level: Level, grade: number): string {
  if (level === 'college') return `College, ${ordinal(grade)} year`
  if (grade === 0) return 'Kindergarten'
  return grade >= 11 ? `Grade ${grade} (Senior High School)` : grade >= 7 ? `Grade ${grade} (Junior High School)` : `Grade ${grade} (Elementary)`
}

export function lessonMinutes(level: Level, grade: number): number {
  if (level === 'college') return 90
  if (level === 'elementary') return grade === 0 ? 30 : grade <= 3 ? 40 : 45
  return grade >= 11 ? 60 : 45
}

/** Grade band label shown under the slider (DepEd K–12 key stages). */
export function bandLabel(level: Level, grade: number): string {
  if (level === 'college') return 'Higher education'
  if (grade === 0) return 'Kindergarten'
  if (grade <= 3) return 'Key Stage 1 • Grades 1–3'
  if (grade <= 6) return 'Key Stage 2 • Grades 4–6'
  if (grade <= 10) return 'Junior High School • Grades 7–10'
  return 'Senior High School • Grades 11–12'
}

/** Subjects offered for a grade; the list changes with the grade band. */
export function subjectsFor(level: Level, grade: number): string[] {
  if (level === 'college') {
    return [
      'General Biology',
      'General Chemistry',
      'Physics',
      'Calculus',
      'Statistics',
      'Computer Programming',
      'Purposive Communication',
      'Science, Technology & Society',
      'Principles of Teaching',
    ]
  }
  if (level === 'elementary') {
    if (grade === 0) return ['Language & Literacy', 'Numeracy', 'Understanding the Environment', 'Values & Character', 'Arts & Movement']
    if (grade <= 3) return ['Language', 'Reading & Literacy', 'Mathematics', 'Science', 'Makabansa', 'GMRC']
    return ['English', 'Filipino', 'Mathematics', 'Science', 'Araling Panlipunan', 'MAPEH', 'EPP', 'GMRC']
  }
  if (grade <= 10) {
    return ['Biology', 'Chemistry', 'Physics', 'Earth Science', 'Mathematics', 'English', 'Filipino', 'Araling Panlipunan', 'MAPEH', 'TLE']
  }
  return [
    'General Biology',
    'General Chemistry',
    'General Physics',
    'Earth & Life Science',
    'General Mathematics',
    'Statistics & Probability',
    'Oral Communication',
    '21st Century Literature',
  ]
}

const SUGGESTIONS: { level: Level; minGrade: number; maxGrade: number; topic: string; subject: string }[] = [
  { level: 'elementary', minGrade: 0, maxGrade: 0, topic: 'Shapes Around Us', subject: 'Numeracy' },
  { level: 'elementary', minGrade: 0, maxGrade: 0, topic: 'My Five Senses', subject: 'Understanding the Environment' },
  { level: 'elementary', minGrade: 1, maxGrade: 3, topic: 'Counting by 2s, 5s and 10s', subject: 'Mathematics' },
  { level: 'elementary', minGrade: 1, maxGrade: 3, topic: 'Parts of a Plant', subject: 'Science' },
  { level: 'elementary', minGrade: 1, maxGrade: 3, topic: 'Reading Short Vowel Words', subject: 'Reading & Literacy' },
  { level: 'elementary', minGrade: 4, maxGrade: 6, topic: 'Adding Dissimilar Fractions', subject: 'Mathematics' },
  { level: 'elementary', minGrade: 4, maxGrade: 6, topic: 'The Water Cycle', subject: 'Science' },
  { level: 'elementary', minGrade: 4, maxGrade: 6, topic: 'Pangngalan at Panghalip', subject: 'Filipino' },
  { level: 'elementary', minGrade: 4, maxGrade: 6, topic: 'Regions of the Philippines', subject: 'Araling Panlipunan' },
  { level: 'highschool', minGrade: 7, maxGrade: 10, topic: 'Photosynthesis & Cellular Respiration', subject: 'Biology' },
  { level: 'highschool', minGrade: 7, maxGrade: 10, topic: 'Stoichiometry', subject: 'Chemistry' },
  { level: 'highschool', minGrade: 7, maxGrade: 10, topic: 'Cell Division', subject: 'Biology' },
  { level: 'highschool', minGrade: 7, maxGrade: 10, topic: 'Linear Equations in Two Variables', subject: 'Mathematics' },
  { level: 'highschool', minGrade: 11, maxGrade: 12, topic: 'Cellular Respiration Pathways', subject: 'General Biology' },
  { level: 'highschool', minGrade: 11, maxGrade: 12, topic: 'Gas Laws', subject: 'General Chemistry' },
  { level: 'highschool', minGrade: 11, maxGrade: 12, topic: 'Normal Distribution', subject: 'Statistics & Probability' },
  { level: 'highschool', minGrade: 11, maxGrade: 12, topic: 'Plate Tectonics', subject: 'Earth & Life Science' },
  { level: 'college', minGrade: 1, maxGrade: 4, topic: 'Enzyme Kinetics', subject: 'General Biology' },
  { level: 'college', minGrade: 1, maxGrade: 4, topic: 'Chemical Equilibrium', subject: 'General Chemistry' },
  { level: 'college', minGrade: 1, maxGrade: 4, topic: 'Hypothesis Testing', subject: 'Statistics' },
  { level: 'college', minGrade: 1, maxGrade: 4, topic: 'Recursion', subject: 'Computer Programming' },
  { level: 'college', minGrade: 1, maxGrade: 4, topic: 'Outcomes-Based Lesson Design', subject: 'Principles of Teaching' },
]

/** Topic ideas for the chosen grade, with the selected subject's ideas first. */
export function topicSuggestions(level: Level, grade: number, subject: string): { topic: string; subject: string }[] {
  const inBand = SUGGESTIONS.filter((s) => s.level === level && grade >= s.minGrade && grade <= s.maxGrade)
  return [...inBand.filter((s) => s.subject === subject), ...inBand.filter((s) => s.subject !== subject)].slice(0, 4)
}

/** Where a level's slider starts when the teacher switches to it. */
export function defaultGrade(level: Level): number {
  return level === 'elementary' ? 4 : level === 'highschool' ? 9 : 1
}
