/**
 * @file Keyless odai decision leg for the weekly update. Replaces the keyed
 *   agent's dep-judgment role: the on-device model classifies the applied
 *   change (one `classify-deps` over the narrowed diff summary) and plans
 *   the remaining candidates (one `weekly-update` over the raw outdated
 *   text), both in ONE backend launch via the seam's `runOdaiBatch`. Code
 *   owns everything around the model: input narrowing, output validation,
 *   and the receipts markdown the run log and PR body carry. Fail-open by
 *   construction — every environment gap reads as `skipped` and the caller
 *   falls back to its keyed path or plain deterministic result.
 */

import {
  localAssistEnabled,
  resolveOdaiBin,
  runOdaiBatch,
} from '../_shared/odai.mts'
import { narrowDependencyDiff, parseDependencyDiff } from './diff-narrow.mts'

/**
 * The per-task prompt budget. Decision tasks run extract-then-decide with
 * best-of-N inside the CLI, so they need more room than a summary; 90s per
 * task keeps a two-entry batch under the seam's scaled spawn backstop while
 * tolerating a CPU-only first prompt.
 */
export const ODAI_DECISION_TIMEOUT_MS = 90_000

/**
 * One weekly-update plan row as validated out of the model reply. Mirrors
 * the odai CLI's WeeklyUpdateEntry contract.
 */
export interface OdaiPlanRow {
  readonly from: string
  readonly name: string
  readonly reason: string
  readonly to: string
}

/**
 * The decision leg's outcome. `ok` carries the receipts markdown the run
 * log and PR body append verbatim; `skipped` covers every environment gap
 * (opt-out, no bin, no backend); `failed` is a real model/validation
 * failure the caller may log before falling back.
 */
export type OdaiDecisionRun =
  | { readonly outcome: 'ok'; readonly markdown: string }
  | { readonly outcome: 'skipped'; readonly reason: string }
  | { readonly outcome: 'failed'; readonly reason: string }

export interface OdaiDecisionConfig {
  readonly cwd: string
  /**
   * Unified diff of everything the deterministic chain changed.
   */
  readonly diffText: string
  /**
   * Raw `pnpm outdated` text — the plan task's input, untouched.
   */
  readonly outdatedText: string
  /**
   * The fleet soak window the plan reasons against.
   */
  readonly soakWindowDays: number
}

/**
 * Run the keyless decision leg. Never throws.
 */
export async function runOdaiDecisions(
  config: OdaiDecisionConfig,
): Promise<OdaiDecisionRun> {
  const { cwd, diffText, outdatedText, soakWindowDays } = {
    __proto__: null,
    ...config,
  } as OdaiDecisionConfig
  if (!localAssistEnabled(cwd)) {
    return { outcome: 'skipped', reason: 'ai.localAssist is not enabled' }
  }
  const bin = resolveOdaiBin()
  if (!bin) {
    return { outcome: 'skipped', reason: 'no odai bin resolved' }
  }

  const entries = []
  if (diffText.trim() !== '') {
    const narrowed = narrowDependencyDiff(parseDependencyDiff(diffText))
    entries.push({
      id: 'classify',
      input: JSON.stringify(narrowed),
      task: 'classify-deps' as const,
    })
  }
  if (outdatedText.trim() !== '') {
    entries.push({
      id: 'plan',
      input: { outdated: outdatedText, soakWindowDays },
      task: 'weekly-update' as const,
    })
  }
  if (entries.length === 0) {
    return {
      outcome: 'skipped',
      reason: 'no applied diff and no outdated candidates — nothing to decide',
    }
  }

  const run = await runOdaiBatch(entries, {
    bin,
    cwd,
    timeoutMs: ODAI_DECISION_TIMEOUT_MS,
  })
  if (run.outcome !== 'ok') {
    return run
  }

  const sections: string[] = []
  for (const line of run.lines) {
    if (line.id === 'classify') {
      sections.push(
        line.ok
          ? classificationSection(line.value)
          : `**Change classification:** unavailable — ${line.error}`,
      )
    } else if (line.id === 'plan') {
      sections.push(
        line.ok
          ? planSection(line.value, soakWindowDays)
          : `**Update plan:** unavailable — ${line.error}`,
      )
    }
  }
  if (sections.length === 0) {
    return { outcome: 'failed', reason: 'odai batch returned no known lines' }
  }
  return {
    outcome: 'ok',
    markdown: `### On-device decision receipts (odai)\n\n${sections.join('\n\n')}\n`,
  }
}

/**
 * Render the classify-deps reply. Tolerant of shape drift: anything that
 * fails structural validation renders as an explicit unavailable line, so a
 * degraded model reply can never fabricate a clean-looking receipt.
 */
function classificationSection(value: unknown): string {
  const v = value as {
    flags?: unknown | undefined
    note?: unknown | undefined
    surprise?: unknown | undefined
  }
  if (typeof v?.note !== 'string' || !Array.isArray(v.flags)) {
    return '**Change classification:** unavailable — reply failed validation'
  }
  const flags = v.flags.filter(
    (f): f is string => typeof f === 'string' && f !== '',
  )
  const flagText = flags.length > 0 ? ` (flags: ${flags.join(', ')})` : ''
  const surprise =
    v.surprise === true
      ? '\n\n> [!WARNING]\n> The model flagged this change as SURPRISING — review before merge.'
      : ''
  return `**Change classification:** ${v.note}${flagText}${surprise}`
}

/**
 * Render the weekly-update plan reply as a table. Rows failing structural
 * validation are dropped and counted, never silently reshaped.
 */
function planSection(value: unknown, soakWindowDays: number): string {
  const updates = (value as { updates?: unknown | undefined })?.updates
  if (!Array.isArray(updates)) {
    return '**Update plan:** unavailable — reply failed validation'
  }
  const rows: OdaiPlanRow[] = []
  let dropped = 0
  for (const u of updates) {
    const row = u as OdaiPlanRow
    if (
      typeof row?.name === 'string' &&
      typeof row?.from === 'string' &&
      typeof row?.to === 'string' &&
      typeof row?.reason === 'string'
    ) {
      rows.push(row)
    } else {
      dropped += 1
    }
  }
  if (rows.length === 0) {
    return `**Update plan (soak ${soakWindowDays}d):** no candidates proposed.`
  }
  const table = [
    '| dependency | from | to | reason |',
    '| --- | --- | --- | --- |',
    ...rows.map(r => `| ${r.name} | ${r.from} | ${r.to} | ${r.reason} |`),
  ].join('\n')
  const droppedNote =
    dropped > 0 ? `\n\n${dropped} malformed row(s) dropped by validation.` : ''
  return `**Update plan (soak ${soakWindowDays}d):**\n\n${table}${droppedNote}`
}
