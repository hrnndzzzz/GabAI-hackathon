import { DEMO_CLASSES, DEMO_HISTORY } from './mock'
import { submissionRow, type RecordRow, type Workspace } from './workspace'

/** Every approved result in the workspace, newest first (demo history included in demo mode). */
export function recordRows(ws: Workspace, demo: boolean): RecordRow[] {
  const rows = ws.submissions.map(submissionRow)
  return (demo ? [...rows, ...DEMO_HISTORY] : rows).sort((a, b) => Date.parse(b.dateISO) - Date.parse(a.dateISO))
}

/** Class labels in display order: demo sections first, then any the teacher has used. */
export function classLabels(ws: Workspace, demo: boolean): string[] {
  const labels = demo ? DEMO_CLASSES.map((c) => c.label) : []
  for (const label of [...ws.assessments.map((a) => a.classLabel), ...ws.submissions.map((s) => s.classLabel)]) {
    if (label && !labels.includes(label)) labels.push(label)
  }
  return labels
}

export function filesOnDevice(ws: Workspace, demo: boolean): number {
  const seeded = demo ? DEMO_CLASSES.reduce((s, c) => s + c.files, 0) : 0
  return seeded + ws.submissions.length + (demo ? 0 : ws.modules.length)
}
