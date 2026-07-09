/**
 * @file Canonical GitHub bot-login detector for fleet scripts. One source of
 *   truth for "is this login an automation account rather than a person" — used
 *   by the team-activity monitor to skip Dependabot/Renovate/etc. and by any
 *   fleet script that filters bot noise. Generic: no org-specific accounts, so
 *   it cascades to every member unchanged. The repo-tier `reviewing-team-prs`
 *   sampler re-exports from here so the two never drift.
 */

// Login prefixes that identify review/automation bots. A trailing `[bot]` also
// counts. Sorted; extend here, never fork a second copy.
export const BOT_PREFIXES: readonly string[] = [
  'coderabbit',
  'copilot',
  'cursor',
  'dependabot',
  'github-actions',
  'linear',
  'renovate',
]

/**
 * True when a login belongs to a bot rather than a person. Matches an exact
 * prefix, a `<prefix>-` / `<prefix>[` lead, or any `…[bot]` suffix. Empty /
 * whitespace input is not a bot.
 */
export function isBotLogin(login: string): boolean {
  const normalized = login.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  if (normalized.endsWith('[bot]')) {
    return true
  }
  return BOT_PREFIXES.some(
    prefix =>
      normalized === prefix ||
      normalized.startsWith(`${prefix}-`) ||
      normalized.startsWith(`${prefix}[`),
  )
}
