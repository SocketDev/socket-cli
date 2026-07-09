/**
 * @file Canonical GitHub bot-login detector for fleet scripts. One source of
 *   truth for "is this login an automation account rather than a person" — used
 *   by the team-activity monitor and the heartbeat PR scan to tell a bot
 *   comment (Cursor, Copilot, CodeRabbit, Codex, Claude, Pullfrog, Dependabot,
 *   …) from a real teammate, and by any fleet script that filters bot noise.
 *   Covers the generic CI/review bots plus the fleet's own Socket automation
 *   bot (every fleet member is a Socket repo, so it's universally relevant).
 *   The repo-tier `reviewing-team-prs` sampler re-exports from here so the two
 *   never drift. Every login below was verified to exist on GitHub before it
 *   was added.
 */

// Login prefixes that identify review/automation bots. A trailing `[bot]` also
// counts (most GitHub Apps post as `<name>[bot]`), so this list only needs the
// non-`[bot]` login forms plus a few belt-and-suspenders prefixes. Sorted;
// extend here, never fork a second copy.
export const BOT_PREFIXES: readonly string[] = [
  'chatgpt',
  'claude',
  'coderabbit',
  'coderabbitai',
  'codex',
  'copilot',
  'cursor',
  'dependabot',
  'github-actions',
  'linear',
  'pullfrog',
  'renovate',
  'socket-bot',
  'socket-security',
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
