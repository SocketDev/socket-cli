/**
 * @file Apply uniquely located replacement runs from verified signed hunks.
 */
import { selectCanonicalPatch } from './patch.mts'

interface ReplacementRun {
  before: string
  after: string
}
interface HunkState {
  before: number
  after: number
  previous: string
  run: ReplacementRun
  runs: ReplacementRun[]
}

function finishRun(state: HunkState): boolean {
  const run = state.run
  if (!run.before && !run.after) {
    return true
  }
  if (!run.before) {
    return false
  }
  state.runs.push(run)
  state.run = { before: '', after: '' }
  return true
}

function consumeHunkLine(state: HunkState, line: string): boolean {
  const tag = line[0]
  if (tag === ' ') {
    state.before += 1
    state.after += 1
    state.previous = tag
    return finishRun(state)
  }
  if (tag === '-') {
    state.before += 1
    state.run.before += line.slice(1)
  } else if (tag === '+') {
    state.after += 1
    state.run.after += line.slice(1)
  } else if (
    line === '\\ No newline at end of file' ||
    line === '\\ No newline at end of file\n'
  ) {
    if (state.previous === '-') {
      state.run.before = state.run.before.slice(0, -1)
    } else if (state.previous === '+') {
      state.run.after = state.run.after.slice(0, -1)
    } else if (state.previous !== ' ') {
      return false
    }
    return true
  } else {
    return false
  }
  state.previous = tag
  return true
}

function hunkReplacements(section: string): ReplacementRun[] | undefined {
  // Preserve each line terminator, including a final unterminated line.
  const lines = section.match(/[^\n]*\n|[^\n]+$/gu) ?? []
  const header = lines.shift()
  // Capture old and new line counts from one complete unified hunk header.
  const match =
    header && /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@[^\n]*\n$/u.exec(header)
  if (!match) {
    return undefined
  }
  const state: HunkState = {
    before: 0,
    after: 0,
    previous: '',
    run: { before: '', after: '' },
    runs: [],
  }
  if (!lines.every(line => consumeHunkLine(state, line)) || !finishRun(state)) {
    return undefined
  }
  if (
    state.before !== Number(match[1] ?? 1) ||
    state.after !== Number(match[2] ?? 1)
  ) {
    return undefined
  }
  return state.runs
}

function utf8Text(bytes: Uint8Array): string | undefined {
  const text = Buffer.from(bytes).toString('utf8')
  return !text.includes('\0') && Buffer.from(text).equals(bytes)
    ? text
    : undefined
}

function replaceUniqueRun(
  text: string,
  run: ReplacementRun,
): string | undefined {
  const index = text.indexOf(run.before)
  if (
    index < 0 ||
    (index > 0 && text[index - 1] !== '\n') ||
    text.indexOf(run.before, index + 1) !== -1 ||
    (!run.before.endsWith('\n') && index + run.before.length !== text.length)
  ) {
    return undefined
  }
  return (
    text.slice(0, index) + run.after + text.slice(index + run.before.length)
  )
}

export function applyCanonicalReplacements(
  content: Uint8Array,
  patch: Uint8Array,
): Uint8Array | undefined {
  let text = utf8Text(content)
  const delta = utf8Text(patch)
  if (text === undefined || delta === undefined) {
    return undefined
  }
  const first = delta.split(/\r?\n/, 1)[0]
  const source = first?.startsWith('diff --git a/')
    ? first.slice('diff --git a/'.length).split(' b/', 1)[0]
    : undefined
  if (!source || !selectCanonicalPatch(delta, source)) {
    return undefined
  }
  const sections = delta.split(/(?=^@@ )/mu).slice(1)
  let total = 0
  for (
    let sectionIndex = 0, { length } = sections;
    sectionIndex < length;
    sectionIndex += 1
  ) {
    const runs = hunkReplacements(sections[sectionIndex]!)
    if (!runs) {
      return undefined
    }
    for (
      let runIndex = 0, { length: runLength } = runs;
      runIndex < runLength;
      runIndex += 1
    ) {
      total += 1
      text = replaceUniqueRun(text, runs[runIndex]!)
      if (text === undefined) {
        return undefined
      }
    }
  }
  return total > 0 ? Buffer.from(text) : undefined
}
