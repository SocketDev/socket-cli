// Squash-history roster detection for the pre-push blocked-message teaching.
// Gate-free; reads the fleet-repos roster off disk to tell whether THIS repo
// opts into the squash-history convention. Kept separate from the push gates so
// the roster-read logic has one home.

import { existsSync, readFileSync } from 'node:fs'

import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// Git remotes end in `/name` or `:name`; capture the name and drop optional `.git`.
export const REMOTE_REPO_RE = /[/:](?<repo>[^/:]+?)(?:\.git)?$/

// True when THIS repo opts into the squash-history convention (roster
// `optIns: ['squash-history']`). Drives the land-freely teaching in the blocked
// message: in a squash-history repo, a gate blocked on in-flight WIP or
// moving-target cascade/format drift (from a parallel session) is NOT a wall —
// local main is canonical + flattens, so committing the dirty tree + a
// `--no-verify` push is the sanctioned way through.
export function isSquashHistoryRepo(): boolean {
  const readGit = (args: string[]): string => {
    const r = spawnSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return r.status === 0 && typeof r.stdout === 'string' ? r.stdout.trim() : ''
  }
  const root = readGit(['rev-parse', '--show-toplevel'])
  if (!root) {
    return false
  }
  const remote = readGit(['config', '--get', 'remote.origin.url'])
  const repo =
    REMOTE_REPO_RE.exec(remote)?.groups?.['repo'] ?? path.basename(root)
  const rosterRels = [
    'template/base/.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
    '.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json',
  ]
  for (let i = 0, { length } = rosterRels; i < length; i += 1) {
    const p = path.join(root, rosterRels[i]!)
    if (!existsSync(p)) {
      continue
    }
    try {
      const roster = JSON.parse(readFileSync(p, 'utf8')) as {
        repos?:
          | ReadonlyArray<{
              name?: string | undefined
              optIns?: readonly string[] | undefined
            }>
          | undefined
      }
      const entry = (roster.repos ?? []).find(r => r.name === repo)
      if (entry) {
        return (entry.optIns ?? []).includes('squash-history')
      }
    } catch {
      // Unreadable/malformed roster — treat as non-squash (no teaching).
    }
  }
  return false
}
