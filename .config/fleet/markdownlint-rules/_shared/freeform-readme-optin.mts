/**
 * @file Shared helper for the fleet README markdown rules: detect whether the
 *   repo being linted has opted into a freeform (non-skeleton) README via the
 *   cascade roster (`optIns: ['freeform-readme']`). Product / marketplace repos
 *   (the VS Code + browser extensions, the skills directory) carry public
 *   READMEs that don't fit the five-section infra skeleton; the
 *   required-sections rule bails for them, while the universal social-badge /
 *   wheelhouse-leak / sibling-path rules still apply. Sync (markdownlint-cli2
 *   calls rule init synchronously) and dependency-free (loaded as a regular ESM
 *   module, not bundled). Resolves the current repo name from
 *   SOCKET_FLEET_REPO_NAME (CI) then the cwd basename (local checkout), and
 *   reads the roster relative to the cwd.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function resolveRepoName(cwd) {
  return process.env['SOCKET_FLEET_REPO_NAME'] || path.basename(cwd)
}

export function isFreeformReadmeOptIn(cwd = process.cwd()) {
  const rosterPath = path.join(
    cwd,
    '.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
  )
  if (!existsSync(rosterPath)) {
    return false
  }
  let roster
  try {
    roster = JSON.parse(readFileSync(rosterPath, 'utf8'))
  } catch {
    return false
  }
  const name = resolveRepoName(cwd)
  const repos = roster && Array.isArray(roster.repos) ? roster.repos : []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const r = repos[i]
    if (r && r.name === name) {
      return Array.isArray(r.optIns) && r.optIns.includes('freeform-readme')
    }
  }
  return false
}
