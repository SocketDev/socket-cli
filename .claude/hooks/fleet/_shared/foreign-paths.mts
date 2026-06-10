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
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Untracked-by-default path prefixes — kept in lock-step with
// dirty-worktree-stop-guard. Vendored / build-copied trees are
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

// git's global options that sit BEFORE the subcommand. `-C <dir>` and
// `-c <name>=<value>` take a value (the next token); the rest are flags. A
// session that runs the parallel-safe `git -C <repo> mv old new` form would
// otherwise be read as verb `-C`, skipped entirely, and its authorship lost —
// so the guards false-fire on this session's OWN renamed/staged files.
const GIT_GLOBAL_OPTS_WITH_VALUE = new Set(['-C', '-c'])

/**
 * Advance past `git`'s global options to the index of the subcommand token.
 * Handles value-taking opts (`-C <dir>`, `-c <cfg>`), `--key=value` /
 * `--key value` long forms, and bare flags (`--no-pager`, `-p`). `start` is the
 * index of the `git` token; returns the index of the verb (`add`/`mv`/`rm`/…)
 * or `tokens.length` when none remains.
 */
export function gitVerbIndex(tokens: readonly string[], start: number): number {
  let k = start + 1
  while (k < tokens.length) {
    const tok = tokens[k]!
    if (!tok.startsWith('-')) {
      return k
    }
    // `--git-dir=…` / `-c key=val` carry their value inline — one token.
    if (tok.includes('=')) {
      k += 1
      continue
    }
    // `-C <dir>` / `-c <cfg>` / `--git-dir <dir>` consume the next token.
    if (GIT_GLOBAL_OPTS_WITH_VALUE.has(tok) || tok === '--git-dir') {
      k += 2
      continue
    }
    // Bare flag (`--no-pager`, `-p`): skip just this token.
    k += 1
  }
  return k
}

/**
 * Parse `git add|mv|rm <path>` arguments out of a Bash command line and add the
 * resolved absolute paths to `touched`. Broad forms (`git add .` / `-A`) are
 * NOT surgical adds and are skipped — they don't establish authorship of a
 * specific file. Tolerates leading `NAME=val` env assignments, git global
 * options (`git -C <dir> mv …`), and `&&` / `;` / `|` chains. Paths are
 * resolved against `-C <dir>` when present (so repo-relative args under
 * `git -C <repo>` resolve to the repo, not the hook's cwd).
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
    // A `-C <dir>` anywhere in the global-option run sets the resolve base.
    let base = ''
    for (let g = j + 1; g < tokens.length - 1; g += 1) {
      if (tokens[g] === '-C') {
        base = tokens[g + 1]!
        break
      }
      if (!tokens[g]!.startsWith('-')) {
        break
      }
    }
    const verbIndex = gitVerbIndex(tokens, j)
    const verb = tokens[verbIndex]
    if (verb !== 'add' && verb !== 'mv' && verb !== 'rm') {
      continue
    }
    for (const arg of tokens.slice(verbIndex + 1)) {
      if (arg.startsWith('-') || arg === '.') {
        continue
      }
      touched.add(base ? path.resolve(base, arg) : path.resolve(arg))
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

// ── Same-turn touched-path ledger ──────────────────────────────────
//
// The transcript JSONL lags WITHIN a turn: a PreToolUse hook fires BEFORE the
// tool call it gates is appended to the transcript, so a second Edit to a file
// the session already edited this turn reads as untouched (readTouchedPaths
// walks only what's persisted). The parallel-agent guards then misread the
// session's OWN in-flight file as a concurrent agent's work and block it.
//
// The fix is a ledger the guard maintains itself: on each gated edit the hook
// appends the absolute target path to a per-session file under the OS temp dir;
// the next invocation unions that ledger into the touched set. Because the hook
// writes it synchronously, it never lags. Keyed by the transcript path (the
// session identity) so parallel sessions don't share a ledger. Append-only,
// newline-delimited; fail-open on any I/O error (a missing ledger just falls
// back to transcript-only authorship — the pre-existing behavior).

// Derive the ledger file path for a session. Returns undefined when there is no
// transcript path to key on (the caller then skips the ledger entirely).
export function touchedLedgerPath(
  transcriptPath: string | undefined,
): string | undefined {
  if (!transcriptPath) {
    return undefined
  }
  const key = createHash('sha256')
    .update(transcriptPath)
    .digest('hex')
    .slice(0, 16)
  return path.join(os.tmpdir(), 'socket-fleet-touched', `${key}.paths`)
}

/**
 * Record an absolute path as touched-by-this-session in the per-session ledger.
 * Call this from a guard right before it ALLOWS an edit, so the next invocation
 * (same turn, transcript not yet flushed) recognizes the file as the session's
 * own. No-op on missing transcript path or any I/O error (fail-open).
 */
export function recordTouchedPath(
  transcriptPath: string | undefined,
  absPath: string,
): void {
  const ledger = touchedLedgerPath(transcriptPath)
  if (!ledger) {
    return
  }
  try {
    mkdirSync(path.dirname(ledger), { recursive: true })
    appendFileSync(ledger, `${path.resolve(absPath)}\n`)
  } catch {
    // Fail-open: an unwritable temp dir just means no same-turn memory.
  }
}

/**
 * Record every `git add|mv|rm <path>` target in a Bash command into the
 * per-session ledger. Closes the gitMv→Edit gap: a `git mv old new` in one Bash
 * call followed by an Edit to `new` in the same turn would otherwise read as
 * foreign, because the transcript hasn't flushed the Bash call when the Edit's
 * PreToolUse hook fires. Recording the targets synchronously here means the
 * Edit's `readSessionTouchedPaths` sees `new` immediately. Reuses
 * `addTouchedFromBash` for the parsing (so `git -C <repo>` resolves correctly).
 * No-op on missing transcript path or any I/O error (fail-open).
 */
export function recordTouchedFromBash(
  transcriptPath: string | undefined,
  command: string,
): void {
  if (!touchedLedgerPath(transcriptPath)) {
    return
  }
  const touched = new Set<string>()
  addTouchedFromBash(command, touched)
  for (const abs of touched) {
    recordTouchedPath(transcriptPath, abs)
  }
}

/**
 * Read the per-session ledger into a set of absolute paths. Empty set on
 * missing ledger / transcript / read error.
 */
export function readLedgerPaths(
  transcriptPath: string | undefined,
): Set<string> {
  const out = new Set<string>()
  const ledger = touchedLedgerPath(transcriptPath)
  if (!ledger) {
    return out
  }
  let raw: string
  try {
    raw = readFileSync(ledger, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const p = line.trim()
    if (p) {
      out.add(p)
    }
  }
  return out
}

/**
 * The session's touched-path set: the transcript-derived authorship UNION the
 * same-turn ledger. This is what the parallel-agent guards should consult so a
 * file the session edited earlier this turn (not yet in the transcript) is
 * recognized as its own. Drop-in replacement for `readTouchedPaths` at the
 * guard call sites.
 */
export function readSessionTouchedPaths(
  transcriptPath: string | undefined,
): Set<string> {
  const touched = readTouchedPaths(transcriptPath)
  for (const p of readLedgerPaths(transcriptPath)) {
    touched.add(p)
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
 * within `maxAgeMs` of `now`, AND - it is not a staged rename (index column
 * `R`), which is always a deliberate `git mv` in this checkout, never a
 * parallel agent's loose edit. Deleted paths (no mtime) are included only if
 * their status is `D` — a delete by another agent is still foreign. Returns
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
    // A staged rename (index column `R`, e.g. `R ` / `RM`) is a deliberate
    // `git mv` / `git add` that landed in THIS checkout's index — a parallel
    // agent's loose edit never shows up pre-staged in our index, it shows as an
    // unstaged ` M` / `??`. Without this, a `git mv old new` whose destination
    // path got variable-expanded in the Bash command (so `addTouchedFromBash`
    // couldn't capture the literal target) reads as foreign, and the guard
    // false-blocks the session's own renamed file. The index-column check keys
    // off the rename being staged, not off authorship parsing.
    if (entry.status[0] === 'R') {
      continue
    }
    const isDelete = entry.status.includes('D')
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
