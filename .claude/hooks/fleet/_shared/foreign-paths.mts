/**
 * @file Shared heuristic for "which dirty paths in this checkout were authored
 *   by ANOTHER agent, not this session". Two responsibilities the
 *   parallel-agent hooks (and overeager-staging-guard) share:
 *
 *   1. `readTouchedPaths(transcriptPath)` — the set of absolute paths THIS session
 *      modified: Edit / Write `file_path` targets plus `git add|mv|rm <path>`
 *      arguments parsed out of Bash commands. Lifted here from
 *      overeager-staging-guard so the three consumers share one implementation
 *      instead of drifting copies.
 *   2. `listForeignDirtyPaths(repoDir, touched, opts)` — dirty paths (`git status
 *      --porcelain`) that this session did NOT touch and whose mtime is recent
 *      (so stale pre-session dirt doesn't false-fire). These are the likely
 *      fingerprints of a concurrent Claude session sharing the `.git/` — the
 *      failure mode where `git add -A` / `git stash` / `git reset --hard` would
 *      sweep up or destroy another agent's work. Fail-open contract (matches
 *      the rest of `_shared/`): every helper returns a safe default on any
 *      parse / I/O error rather than throwing. A hook that crashes wedges every
 *      Claude Code call; one that returns "nothing foreign" simply falls
 *      through to the hook's default decision.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// Untracked-by-default path prefixes — kept in lock-step with
// dirty-worktree-on-stop-reminder. Vendored / build-copied trees are
// expected to be dirty and are never "another agent's work".
const UNTRACKED_BY_DEFAULT_PREFIXES = [
  'additions/source-patched/',
  'vendor/',
  'third_party/',
  'external/',
  'upstream/',
  'deps/',
  'pkg-node/',
]

// A foreign path must have changed within this window to count. Stale
// dirt left over from before the session opened isn't a live parallel
// agent. 30 minutes balances "the other agent is actively working" against
// clock skew + a slow turn.
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000

export interface ForeignPathsOptions {
  /**
   * Max age (ms) of a dirty path's mtime to count as foreign.
   */
  readonly maxAgeMs?: number | undefined
  /**
   * Injectable clock for tests. Defaults to `Date.now()`.
   */
  readonly now?: number | undefined
}

export function isUntrackedByDefault(p: string): boolean {
  for (const prefix of UNTRACKED_BY_DEFAULT_PREFIXES) {
    if (p.startsWith(prefix)) {
      return true
    }
  }
  return /(^|\/)[^/]+-(?:bundled|vendored)(\/|$)/.test(p)
}

/**
 * Parse `git add|mv|rm <path>` arguments out of a Bash command line and add the
 * resolved absolute paths to `touched`. Broad forms (`git add .` / `-A`) are
 * NOT surgical adds and are skipped — they don't establish authorship of a
 * specific file. Tolerates leading `NAME=val` env assignments and `&&` / `;` /
 * `|` chains.
 */
export function addTouchedFromBash(
  command: string,
  touched: Set<string>,
): void {
  const segments = command.split(/(?:&&|\|\||;|\n)/)
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const tokens = segments[i]!.trim().split(/\s+/)
    let j = 0
    while (j < tokens.length && tokens[j]!.includes('=')) {
      j += 1
    }
    if (tokens[j] !== 'git') {
      continue
    }
    const verb = tokens[j + 1]
    if (verb !== 'add' && verb !== 'mv' && verb !== 'rm') {
      continue
    }
    for (const arg of tokens.slice(j + 2)) {
      if (arg.startsWith('-') || arg === '.') {
        continue
      }
      touched.add(path.resolve(arg))
    }
  }
}

/**
 * The set of absolute paths THIS session modified, read from the transcript
 * JSONL: Edit / Write `file_path` plus `git add|mv|rm <path>` Bash arguments.
 * Returns an empty set on missing / unreadable transcript.
 */
export function readTouchedPaths(
  transcriptPath: string | undefined,
): Set<string> {
  const touched = new Set<string>()
  if (!transcriptPath) {
    return touched
  }
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return touched
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const msg = (entry as { message?: unknown }).message
    if (!msg || typeof msg !== 'object') {
      continue
    }
    const content = (msg as { content?: unknown }).content
    if (!Array.isArray(content)) {
      continue
    }
    for (let i = 0, { length } = content; i < length; i += 1) {
      const part = content[i]!
      if (!part || typeof part !== 'object') {
        continue
      }
      const toolName = (part as { name?: unknown }).name
      const toolInput = (part as { input?: unknown }).input
      if (
        typeof toolName !== 'string' ||
        !toolInput ||
        typeof toolInput !== 'object'
      ) {
        continue
      }
      const filePath = (toolInput as { file_path?: unknown }).file_path
      if (
        typeof filePath === 'string' &&
        filePath &&
        (toolName === 'Edit' ||
          toolName === 'Write' ||
          toolName === 'NotebookEdit')
      ) {
        touched.add(path.resolve(filePath))
      }
      const command = (toolInput as { command?: unknown }).command
      if (toolName === 'Bash' && typeof command === 'string') {
        addTouchedFromBash(command, touched)
      }
    }
  }
  return touched
}

export interface DirtyEntry {
  readonly status: string
  readonly path: string
}

/**
 * Parse `git status --porcelain` output, dropping untracked-by-default trees.
 * Rename entries (`R old -> new`) resolve to the new path.
 */
export function parsePorcelain(out: string): DirtyEntry[] {
  const entries: DirtyEntry[] = []
  for (const line of out.split('\n')) {
    if (!line) {
      continue
    }
    const status = line.slice(0, 2)
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const filePath = arrow === -1 ? rest : rest.slice(arrow + 4)
    if (isUntrackedByDefault(filePath)) {
      continue
    }
    entries.push({ status, path: filePath })
  }
  return entries
}

/**
 * Dirty paths this session did NOT author and that changed recently — the
 * fingerprint of a concurrent agent on the same `.git/`. A path qualifies when:
 * - it's dirty (modified / deleted / untracked, minus vendored trees), AND -
 * its resolved absolute path is not in `touched`, AND - its on-disk mtime is
 * within `maxAgeMs` of `now`. Deleted paths (no mtime) are included only if
 * their status is `D`/`R` — a delete by another agent is still foreign. Returns
 * repo-relative paths.
 */
export function listForeignDirtyPaths(
  repoDir: string,
  touched: ReadonlySet<string>,
  opts?: ForeignPathsOptions | undefined,
): string[] {
  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const now = opts?.now ?? Date.now()
  const r = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoDir,
    timeout: 5_000,
  })
  if (r.status !== 0) {
    return []
  }
  const foreign: string[] = []
  for (const entry of parsePorcelain(String(r.stdout))) {
    const abs = path.resolve(repoDir, entry.path)
    if (touched.has(abs)) {
      continue
    }
    const isDelete = entry.status.includes('D') || entry.status.includes('R')
    let recent = isDelete
    if (!recent) {
      try {
        recent = now - statSync(abs).mtimeMs <= maxAgeMs
      } catch {
        // File vanished between status and stat — treat as not-recent
        // rather than crash; the next turn re-checks.
        recent = false
      }
    }
    if (recent) {
      foreign.push(entry.path)
    }
  }
  return foreign
}
