import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  fleetCanonicalEntries,
  isOperatorLocalPath,
  isPerRepoMarkerPath,
} from '../../.claude/hooks/fleet/_shared/fleet-fork.mts'
import { textHasFleetBlockMarkers } from '../../.claude/hooks/fleet/_shared/fleet-markers.mts'

// Each child names one capability or member, never an arbitrary generated
// bucket. Generated universal files map directly to the destination tree.
const TEMPLATE_ROOTS: readonly string[] = [
  path.join('base', 'conditional'),
  'overrides',
  path.join('generated', 'conditional'),
]

/**
 * Candidate template sources for a live repo-relative path.
 */
export function templateTwinPaths(repoRoot: string, file: string): string[] {
  const candidates = [
    path.join(repoRoot, 'template', 'base', 'universal', file),
  ]
  const generatedUniversal = path.join(
    repoRoot,
    'template',
    'generated',
    'universal',
  )
  if (existsSync(generatedUniversal)) {
    candidates.push(path.join(generatedUniversal, file))
  }
  for (let i = 0, { length } = TEMPLATE_ROOTS; i < length; i += 1) {
    const root = path.join(repoRoot, 'template', TEMPLATE_ROOTS[i]!)
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (let j = 0, { length: namesLength } = names; j < namesLength; j += 1) {
      candidates.push(path.join(root, names[j]!, file))
    }
  }
  return candidates
}

/**
 * Whether the live content is byte-identical to one of its template twins.
 *
 * Then it is cascade OUTPUT, not a fork: a fork is a live copy that DIVERGED
 * from canonical. The cascade lands its own mirrors outside this hook chain,
 * but when it loses the index lock to a parallel session it leaves them staged,
 * and only the operator can land them. Refusing that commit leaves no reachable
 * fix - the tool-call guard forbids writing the mirror by hand, and the cascade
 * cannot retry while the lock is held - so the operator's only remaining route
 * is skipping every hook, which is strictly worse than this exemption.
 */
export function matchesTemplateTwin(
  repoRoot: string,
  file: string,
  content: string,
): boolean {
  const candidates = templateTwinPaths(repoRoot, file)
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    let twin: string
    try {
      twin = readFileSync(candidates[i]!, 'utf8')
    } catch {
      continue
    }
    if (twin === content) {
      return true
    }
  }
  return false
}

function readForkGit(repoRoot: string, args: string[]): string {
  const result = spawnSync('git', ['--literal-pathspecs', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  })
  return result.status === 0 ? (result.stdout ?? '') : ''
}

function mergeParentIds(repoRoot: string): string[] {
  const mergeHeadPath = readForkGit(repoRoot, [
    'rev-parse',
    '--git-path',
    'MERGE_HEAD',
  ]).trim()
  const parents = readFileSync(path.resolve(repoRoot, mergeHeadPath), 'utf8')
    .trim()
    .split(/\r?\n/)
  // Each parent is a full SHA-1 (40 hex digits) or SHA-256 (64 hex digits).
  if (
    !parents.every(parent => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(parent))
  ) {
    return []
  }
  return parents
}

export function matchesMergeParentIndex(
  repoRoot: string,
  file: string,
): boolean {
  try {
    const parents = mergeParentIds(repoRoot)
    if (parents.length === 0) {
      return false
    }
    const staged = readForkGit(repoRoot, [
      'ls-files',
      '--stage',
      '-z',
      '--',
      file,
    ])
    // Match one stage-zero entry: mode, object ID, stage, then a tab.
    const entry = /^(\d+) ([a-f0-9]+) 0\t/.exec(staged)
    if (!entry || staged !== `${entry[0]}${file}\0`) {
      return false
    }
    const expected = `${entry[1]} blob ${entry[2]}\t${file}\0`
    for (const parent of parents) {
      if (
        readForkGit(repoRoot, ['cat-file', '-t', parent]).trim() !== 'commit'
      ) {
        return false
      }
      if (
        readForkGit(repoRoot, ['ls-tree', '-z', parent, '--', file]) ===
        expected
      ) {
        return true
      }
    }
  } catch {
    return false
  }
  return false
}

export interface CanonicalForkFinding {
  file: string
}

function isInsideTemplateRelative(file: string): boolean {
  return file === 'template' || file.startsWith('template/')
}

/**
 * Every staged path (repo-relative, POSIX-normalized, add/change/modify
 * only — a caller filters deletions out via `--diff-filter=ACM`) that is
 * fleet-canonical and differs from its canonical source or merge parent.
 */
export function scanCanonicalForkPaths(
  stagedFiles: readonly string[],
  repoRoot: string,
): CanonicalForkFinding[] {
  const entries = fleetCanonicalEntries(repoRoot)
  if (entries.length === 0) {
    return []
  }
  const findings: CanonicalForkFinding[] = []
  for (let i = 0, { length } = stagedFiles; i < length; i += 1) {
    const file = stagedFiles[i]!
    if (isInsideTemplateRelative(file)) {
      continue
    }
    if (isPerRepoMarkerPath(file) || isOperatorLocalPath(file)) {
      continue
    }
    let isCanonical = false
    for (
      let j = 0, { length: entriesLength } = entries;
      j < entriesLength;
      j += 1
    ) {
      const entry = entries[j]!
      // Glob entries are best-effort excluded here too — same conservative
      // call `isCanonicalRelativePath` makes, so a bad pattern can never
      // over-block a commit.
      if (entry.includes('*')) {
        continue
      }
      if (file === entry || file.startsWith(`${entry}/`)) {
        isCanonical = true
        break
      }
    }
    if (!isCanonical) {
      continue
    }
    if (matchesMergeParentIndex(repoRoot, file)) {
      continue
    }
    // Fleet-block allowance: a canonical file carrying `<fleet-canonical>`
    // markers is only PART fleet-managed — content outside the markers is
    // repo-owned, so staging it is normal repo work, not a fork.
    let content = ''
    try {
      content = readFileSync(path.join(repoRoot, file), 'utf8')
    } catch {
      // Unreadable (permissions, binary) — fall through as non-exempt; a
      // canonical path staged unreadable is still worth surfacing.
    }
    if (textHasFleetBlockMarkers(content)) {
      continue
    }
    // Byte-identical to canonical is propagation, not divergence.
    if (matchesTemplateTwin(repoRoot, file, content)) {
      continue
    }
    findings.push({ file })
  }
  return findings
}
