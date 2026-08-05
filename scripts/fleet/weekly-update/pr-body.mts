/**
 * @file Compose the rolling dependency PR's body — pure, so the shell step in
 *   weekly-update.yml never hand-rolls markdown surgery. The weekly update
 *   keeps ONE long-lived PR rather than opening a new one per run. Each run
 *   appends a collapsed, dated `<details>` block recording what it changed,
 *   newest first, under a fixed intro. A same-day re-run REPLACES that day's
 *   block instead of stacking a second copy, so re-running is idempotent. Kept
 *   pure over (body, entry) with no git or gh access: the shell passes the
 *   current body in and writes the result back, and the interesting cases —
 *   first run, later run, same-day re-run, a body someone edited by hand — are
 *   unit-testable without a repo.
 */

const OPEN = '<details>'
const CLOSE = '</details>'

// Opens the fold for one run. The date is the identity: one block per day.
export function entryHeading(date: string): string {
  return `<summary>${date} —`
}

/**
 * One run's collapsed summary block. The dependency table is the payload; the
 * commit subjects go in a nested fold because for a dependency run they are
 * almost always one squashed "chore(deps)" line and carry no information.
 */
export function buildEntry(config: {
  commits: readonly string[]
  date: string
  depTable: string
  note: string
  runUrl: string
}): string {
  const { commits, date, depTable, note, runUrl } = config
  const parts: string[] = [
    OPEN,
    `${entryHeading(date)} <a href="${runUrl}">run</a> · ${note}</summary>`,
    '',
  ]
  parts.push(depTable || '_No dependency ranges changed in this run._', '')
  if (commits.length) {
    parts.push(
      OPEN,
      '<summary>commits</summary>',
      '',
      commits.join('\n'),
      '',
      CLOSE,
      '',
    )
  }
  parts.push(CLOSE)
  return parts.join('\n')
}

/**
 * The index just past the `</details>` that closes the `<details>` at `from`,
 * or -1. Counts nesting rather than taking the first close, because an entry
 * embeds a fold for its commit list and a naive scan would cut the entry in
 * half and leave a dangling `</details>` in the body.
 */
export function endOfBlock(body: string, from: number): number {
  let depth = 0
  let i = from
  while (i < body.length) {
    const nextOpen = body.indexOf(OPEN, i)
    const nextClose = body.indexOf(CLOSE, i)
    if (nextClose === -1) {
      return -1
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      i = nextOpen + OPEN.length
      continue
    }
    depth -= 1
    i = nextClose + CLOSE.length
    if (depth === 0) {
      return i
    }
  }
  return -1
}

/**
 * `body` with any block for `date` removed. Matches on the summary line rather
 * than on position, so a hand-edited body keeps its edits.
 */
export function dropEntryForDate(body: string, date: string): string {
  const heading = entryHeading(date)
  const start = body.indexOf(heading)
  if (start === -1) {
    return body
  }
  // Walk back to the <details> that owns this summary, then forward to the
  // close that balances it.
  const open = body.lastIndexOf(OPEN, start)
  if (open === -1) {
    return body
  }
  const end = endOfBlock(body, open)
  if (end === -1) {
    return body
  }
  return `${body.slice(0, open)}${body.slice(end)}`.replace(/\n{3,}/g, '\n\n')
}

/**
 * `body` with `entry` inserted as the newest block: immediately above the first
 * existing `<details>`, or appended when there is none yet.
 */
export function prependEntry(body: string, entry: string): string {
  const first = body.indexOf(OPEN)
  if (first === -1) {
    return `${body.trimEnd()}\n\n${entry}\n`
  }
  return `${body.slice(0, first)}${entry}\n\n${body.slice(first)}`
}

/**
 * The full refreshed body for a run. `previous` is undefined on the first run.
 */
export function composePrBody(config: {
  base: string
  date: string
  entry: string
  previous: string | undefined
}): string {
  const { base, date, entry, previous } = config
  if (previous === undefined) {
    return [
      '## Rolling dependency update',
      '',
      `One long-lived PR, rebuilt from \`${base}\` on every run so it stays`,
      'mergeable. Each run appends its dependency delta below, newest first.',
      '',
      entry,
      '',
    ].join('\n')
  }
  return prependEntry(dropEntryForDate(previous, date), entry)
}
