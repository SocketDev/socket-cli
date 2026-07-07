/**
 * @file Workspace resolution for the multi-Janus MCP shim. Maps a workspace
 *   NAME (a fleet repo dir name, e.g. `socket-wheelhouse`) to the absolute path
 *   of that repo's `.janus/` directory, by treating each fleet repo as a
 *   sibling of the wheelhouse root and keeping only those that have a `.janus/`
 *   dir. The shim shells the `janus` CLI with `JANUS_ROOT=<that path>` so one
 *   MCP server can drive every repo's queue. This is the stopgap until the
 *   upstream `janus mcp --workspace name=path` lands (then this whole shim is
 *   deleted); see docs/agents.md/fleet/multi-agent-operating-procedure.md.
 *
 *   Discovery is zero-config: the wheelhouse-canonical fleet registry
 *   (`fleet-repos.json`) is the source of repo names; the parent dir of the
 *   wheelhouse root is the sibling search root. A repo with no `.janus/` is
 *   simply absent from the workspace list (it hasn't opted into Janus yet).
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { REPO_ROOT } from './paths.mts'

// The wheelhouse-canonical fleet registry. Names here are sibling repo dir
// names under the parent of REPO_ROOT.
const FLEET_REPOS_JSON = path.join(
  REPO_ROOT,
  'template',
  '.claude',
  'skills',
  'fleet',
  'cascading-fleet',
  'lib',
  'fleet-repos.json',
)

// Fallback registry location for a cascaded member (no `template/` prefix —
// the live copy sits directly under `.claude/`).
const FLEET_REPOS_JSON_LIVE = path.join(
  REPO_ROOT,
  '.claude',
  'skills',
  'fleet',
  'cascading-fleet',
  'lib',
  'fleet-repos.json',
)

export interface Workspace {
  // Workspace name = the fleet repo dir name (the `workspace` MCP param value).
  name: string
  // Absolute path to the repo root.
  repoPath: string
  // Absolute path to the repo's `.janus/` directory.
  janusRoot: string
}

// Shape of the fleet registry we read (only `repos[].name` matters here).
export interface FleetReposFile {
  repos?: Array<{ name?: string | undefined }> | undefined
}

// Read the fleet repo names from whichever registry copy exists (template
// source in the wheelhouse, or the live cascaded copy in a member).
export function readFleetRepoNames(): string[] {
  const registryPath = existsSync(FLEET_REPOS_JSON)
    ? FLEET_REPOS_JSON
    : FLEET_REPOS_JSON_LIVE
  if (!existsSync(registryPath)) {
    return []
  }
  let parsed: FleetReposFile
  try {
    parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as FleetReposFile
  } catch {
    return []
  }
  const repos = parsed.repos ?? []
  const names: string[] = []
  for (let i = 0, { length } = repos; i < length; i += 1) {
    const name = repos[i]?.name
    if (typeof name === 'string' && name) {
      names.push(name)
    }
  }
  return names
}

// Discover the workspaces: every fleet repo (plus the wheelhouse itself) that
// is a sibling directory and has a `.janus/`. Returned sorted by name so the
// list is stable across runs.
export function discoverWorkspaces(): Workspace[] {
  const siblingsRoot = path.dirname(REPO_ROOT)
  // The wheelhouse's own dir name + every registered fleet repo name.
  const candidateNames = new Set<string>([
    path.basename(REPO_ROOT),
    ...readFleetRepoNames(),
  ])
  const workspaces: Workspace[] = []
  for (const name of candidateNames) {
    const repoPath = path.join(siblingsRoot, name)
    const janusRoot = path.join(repoPath, '.janus')
    if (existsSync(janusRoot)) {
      workspaces.push({ janusRoot, name, repoPath })
    }
  }
  workspaces.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return workspaces
}

// Resolve one workspace name to its record, or undefined when unknown / has no
// `.janus/`. The caller turns undefined into a clear MCP error naming the
// allowed set.
export function resolveWorkspace(name: string): Workspace | undefined {
  const all = discoverWorkspaces()
  for (let i = 0, { length } = all; i < length; i += 1) {
    if (all[i]!.name === name) {
      return all[i]
    }
  }
  return undefined
}
