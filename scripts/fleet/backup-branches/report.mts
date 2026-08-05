/*
 * @file The operator-facing report for one repo's prune outcome.
 *
 *   The wording is built as data (`formatOutcomeLines`) and logged separately
 *   (`reportOutcome`) so it can be asserted directly in a unit test. The veto
 *   text in particular has to say different things for a ref that predates the
 *   history root than for one inside current history, and getting that
 *   backwards is how an operator learns to ignore a real finding.
 */

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import type { PruneOutcome } from './prune.mts'

const logger = getDefaultLogger()

// Vetoed refs can name a long file list; print enough to judge, not a wall.
const MAX_VETO_PATHS_SHOWN = 10

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
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.level === 'warn') {
      logger.warn(line.text)
    } else {
      logger.info(line.text)
    }
  }
}
