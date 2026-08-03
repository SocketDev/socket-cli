/**
 * @file Report renderer + the fail-LOUD exit contract. `scanChanged` decides
 *   quiet vs. changed; `renderReport` produces the one-line all-quiet summary
 *   or the multi-line CHANGES digest the recurring loop relays verbatim. An
 *   errored scan counts as changed, so an empty-but-broken run never reads as
 *   all-quiet. This renders a to-do list for a human — it NEVER approves
 *   anything.
 */

import type { ScanReport, TeamActivityConfig } from './types.mts'

export function scanChanged(report: ScanReport): boolean {
  return (
    report.closedDups.length > 0 ||
    report.errors.length > 0 ||
    report.newItems.length > 0 ||
    report.reactionChanges.length > 0 ||
    report.replies.length > 0
  )
}

function dupPairsPhrase(config: TeamActivityConfig): string {
  return config.dupPairs.length
    ? `dup pair ${config.dupPairs.map(p => p.map(n => `#${n}`).join('/')).join(', ')} still open, `
    : ''
}

export function renderReport(
  config: TeamActivityConfig,
  report: ScanReport,
): string {
  if (!scanChanged(report)) {
    return (
      `SCAN: all quiet — heartbeat green, ${config.name}: ` +
      `no open items need review, nothing new on the ` +
      `${config.watchedComments.length} watched comments, ` +
      `${dupPairsPhrase(config)}board unchanged.`
    )
  }
  const lines = ['SCAN: CHANGES']
  for (const item of report.newItems) {
    lines.push(
      `- needs review: ${item.repo}#${item.number} (${item.kind}) ` +
        `${item.title} — ${item.reason} ${item.url}`,
    )
  }
  for (const r of report.replies) {
    const role = r.role === 'pr-author' ? 'PR author' : r.role
    const quote = r.quotedFrom ? `, quotes ${r.quotedFrom}` : ''
    const caution =
      r.quotedFrom && !r.quotedFrom.startsWith(`${config.selfLogin}'`)
        ? ` [NOT a reply to ${config.selfLogin} — engage only if it addresses ${config.selfLogin} directly]`
        : ''
    lines.push(
      `- reply on PR ${r.repo}#${r.pr} by ${r.author} (${role}${quote})${caution} at ${r.createdAt}: ${r.body}`,
    )
  }
  for (const line of report.reactionChanges) {
    lines.push(`- ${line}`)
  }
  for (const line of report.closedDups) {
    lines.push(`- dup pair movement: ${line}`)
  }
  for (const line of report.errors) {
    lines.push(`- scan error: ${line}`)
  }
  return lines.join('\n')
}
