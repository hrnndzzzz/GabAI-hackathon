import { LEVELS, LEVEL_ORDER, gradeShort, type Level } from './levels'

// A section the teacher handles: level → grade → section, with its subject and roster.

export interface TeacherClass {
  id: string
  level: Level
  grade: number
  section: string
  subject: string
  /** Student names, in the order the teacher entered them. */
  students: string[]
}

const SUBJECT_SHORT: Record<string, string> = {
  Biology: 'Bio',
  Chemistry: 'Chem',
  Physics: 'Phys',
  'Earth Science': 'Earth Sci',
  Mathematics: 'Math',
  'Araling Panlipunan': 'AP',
  'General Biology': 'Gen Bio',
  'General Chemistry': 'Gen Chem',
  'General Physics': 'Gen Phys',
  'General Mathematics': 'Gen Math',
  'Earth & Life Science': 'ELS',
  'Statistics & Probability': 'Stat & Prob',
  'Oral Communication': 'Oral Comm',
  '21st Century Literature': '21st Lit',
  'Computer Programming': 'Prog',
  'Purposive Communication': 'Purp Comm',
  'Science, Technology & Society': 'STS',
  'Principles of Teaching': 'PrinTeach',
  'Language & Literacy': 'Lang & Lit',
  'Understanding the Environment': 'Environment',
  'Values & Character': 'Values',
  'Arts & Movement': 'Arts',
  'Reading & Literacy': 'Reading',
}

export function subjectShort(subject: string): string {
  return SUBJECT_SHORT[subject] ?? subject.split(/\s+/)[0]
}

/** The label used everywhere a class is named, e.g. "G9 Bio · Sampaguita". */
export function classLabel(c: Pick<TeacherClass, 'level' | 'grade' | 'section' | 'subject'>): string {
  const subject = c.subject.trim() ? ` ${subjectShort(c.subject.trim())}` : ''
  return `${gradeShort(c.level, c.grade)}${subject} · ${c.section.trim() || 'Section'}`
}

export function levelTone(level: Level) {
  return LEVELS[level].tone
}

export function sortClasses(classes: TeacherClass[]): TeacherClass[] {
  return [...classes].sort(
    (a, b) =>
      LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
      a.grade - b.grade ||
      a.section.localeCompare(b.section) ||
      a.subject.localeCompare(b.subject),
  )
}

export function groupByLevel(classes: TeacherClass[]): { level: Level; classes: TeacherClass[] }[] {
  return LEVEL_ORDER.map((level) => ({ level, classes: sortClasses(classes.filter((c) => c.level === level)) })).filter(
    (g) => g.classes.length,
  )
}

/** Best-effort reverse of classLabel, for assessments that only carry a label (older data, server category). */
export function classFromLabel(label: string, id: string): TeacherClass {
  const [head, section = 'Section'] = label.split('·').map((p) => p.trim())
  const match = /^(K|G(\d+)|Y(\d+))\s*(.*)$/i.exec(head)
  let level: Level = 'highschool'
  let grade = 9
  let subjectPart = head
  if (match) {
    subjectPart = match[4] ?? ''
    if (match[1].toUpperCase() === 'K') {
      level = 'elementary'
      grade = 0
    } else if (match[3]) {
      level = 'college'
      grade = Number(match[3])
    } else {
      grade = Number(match[2])
      level = grade <= 6 ? 'elementary' : 'highschool'
    }
  }
  const subject = Object.entries(SUBJECT_SHORT).find(([, short]) => short === subjectPart)?.[0] ?? subjectPart
  return { id, level, grade, section, subject, students: [] }
}
