/*
 * @file The operator-facing report for one repo, for both lanes: the branch
 *   lane's prune outcome and the stash lane's sweep outcome.
 *
 *   The wording is built as data (`formatOutcomeLines`, `formatStashLines`) and
 *   logged separately (`reportOutcome`, `reportStashOutcome`) so it can be
 *   asserted directly in a unit test. The veto text in particular has to say
 *   different things for a ref that predates the history root than for one
 *   inside current history, and getting that backwards is how an operator learns
 *   to ignore a real finding.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import type { PruneOutcome } from './prune.mts'
import type { StashArchiveState, StashOutcome } from './stashes.mts'

const logger = getDefaultLogger()

// Vetoed refs can name a long file list; print enough to judge, not a wall.
const MAX_VETO_PATHS_SHOWN = 10

// A stash subject is free text and can run to a paragraph; keep the table's
// first line scannable.
const MAX_SUBJECT_WIDTH = 88

export interface ReportOptions {
  readonly dryRun?: boolean | undefined
}

/**
 * One report line plus the stream it belongs on. A vetoed ref is a FINDING, so
 * it goes to warn; everything else is informational.
 */
export interface ReportLine {
  readonly level: 'info' | 'warn'
  readonly text: string
}

/**
 * Build the report lines for one repo's outcome.
 */
export function formatOutcomeLines(
  outcome: PruneOutcome,
  options?: ReportOptions | undefined,
): ReportLine[] {
  const opts = { __proto__: null, ...options } as ReportOptions
  const verb = opts.dryRun === true ? 'would delete' : 'deleted'
  const lines: ReportLine[] = [{ level: 'info', text: outcome.repoDir }]
  if (outcome.deleted.length > 0) {
    lines.push({
      level: 'info',
      text: `  ${verb} ${String(outcome.deleted.length)}:`,
    })
    for (const name of outcome.deleted) {
      lines.push({ level: 'info', text: `    - ${name}` })
    }
  }
  for (const verdict of outcome.kept) {
    lines.push({
      level: 'info',
      text: `  kept ${verdict.ref.name} — ${verdict.keptBecause ?? ''}`,
    })
  }
  // Loud, never a silent skip: a vetoed ref means a rewrite may have lost work,
  // which is a finding in its own right, not merely a ref that stayed.
  for (const veto of outcome.vetoed) {
    lines.push({
      level: 'warn',
      text: veto.preRoot
        ? `  HELD ${veto.name} — predates the default branch's root commit, ` +
          `so its ${String(veto.onlyOnBackup.length)} extra file(s) cannot ` +
          `be told apart from ordinary removals the squash erased. Review ` +
          `by hand before deleting:`
        : `  HELD ${veto.name} — carries ` +
          `${String(veto.onlyOnBackup.length)} file(s) the default branch ` +
          `lacks; a rewrite may have lost work:`,
    })
    const shown = veto.onlyOnBackup.slice(0, MAX_VETO_PATHS_SHOWN)
    for (let i = 0, { length } = shown; i < length; i += 1) {
      lines.push({ level: 'warn', text: `      ${shown[i]!}` })
    }
  }
  if (
    outcome.deleted.length === 0 &&
    outcome.kept.length === 0 &&
    outcome.vetoed.length === 0
  ) {
    lines.push({ level: 'info', text: '  no backup branches' })
  }
  return lines
}

export function reportOutcome(
  outcome: PruneOutcome,
  options?: ReportOptions | undefined,
): void {
  const lines = formatOutcomeLines(outcome, options)
  logReportLines(lines)
}

/**
 * Trim `subject` to `width`, marking the cut so a reader knows there is more.
 */
export function truncateSubject(subject: string, width: number): string {
  const collapsed = subject.replaceAll('\n', ' ').trim()
  return collapsed.length > width
    ? `${collapsed.slice(0, width - 1)}…`
    : collapsed
}

/**
 * What the archive column says for one stash. Spelled out per state because
 * `pending` and `failed` both mean "no ref holds this yet" while meaning
 * opposite things about whether the operator should worry.
 */
export function describeArchiveState(
  state: StashArchiveState,
  archiveRef: string,
): string {
  if (state === 'existing') {
    return `${archiveRef} already holds it`
  }
  if (state === 'created') {
    return `${archiveRef} written`
  }
  if (state === 'pending') {
    return `${archiveRef} would be written`
  }
  return `${archiveRef} COULD NOT BE WRITTEN`
}

/**
 * Build the report lines for one repo's stash sweep: a row per stash carrying
 * its index, subject, verdict, and the evidence behind that verdict.
 *
 * A kept stash is a warn-level line. It is the outcome that leaves work sitting
 * in a shared list, so it is the one an operator has to act on.
 */
export function formatStashLines(outcome: StashOutcome): ReportLine[] {
  const lines: ReportLine[] = [{ level: 'info', text: outcome.repoDir }]
  if (outcome.rows.length === 0) {
    lines.push({ level: 'info', text: '  no stashes' })
    return lines
  }
  const verb = outcome.dryRun ? 'would drop' : 'dropped'
  // A two-digit index would otherwise shift its whole row one column right.
  let refWidth = 0
  for (let i = 0, { length } = outcome.rows; i < length; i += 1) {
    const ref = `stash@{${String(outcome.rows[i]!.verdict.index)}}`
    refWidth = Math.max(refWidth, ref.length)
  }
  let droppedCount = 0
  for (let i = 0, { length } = outcome.rows; i < length; i += 1) {
    const row = outcome.rows[i]!
    const { verdict } = row
    if (row.dropped) {
      droppedCount += 1
    }
    const label = verdict.superseded
      ? `SUPERSEDED (${verdict.reason ?? 'unknown'})`
      : 'KEPT'
    const level = verdict.superseded ? 'info' : 'warn'
    const ref = `stash@{${String(verdict.index)}}`.padEnd(refWidth)
    lines.push({
      level,
      text:
        `  ${ref}  ${label.padEnd(30)}  ` +
        truncateSubject(verdict.subject, MAX_SUBJECT_WIDTH),
    })
    lines.push({
      level,
      text: `      archive   ${describeArchiveState(row.archiveState, row.archiveRef)}`,
    })
    lines.push({ level, text: `      evidence  ${verdict.evidence}` })
    lines.push({
      level,
      text: `      action    ${row.dropped ? verb : 'kept'}`,
    })
  }
  lines.push({
    level: 'info',
    text:
      `  ${String(outcome.rows.length)} stash(es): ${verb} ` +
      `${String(droppedCount)}, kept ` +
      `${String(outcome.rows.length - droppedCount)}`,
  })
  if (outcome.dryRun) {
    lines.push({
      level: 'info',
      text:
        '  dry run — no archive ref was written and no stash was dropped. ' +
        'Re-run with --fix to apply.',
    })
  }
  return lines
}

export function reportStashOutcome(outcome: StashOutcome): void {
  logReportLines(formatStashLines(outcome))
}

/**
 * Send each line to the stream its level names.
 */
export function logReportLines(lines: readonly ReportLine[]): void {
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.level === 'warn') {
      logger.warn(line.text)
    } else {
      logger.info(line.text)
    }
  }
}
