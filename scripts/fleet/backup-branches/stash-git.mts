/*
 * @file The stash lane's git READ layer: the injected exec seam, the argv each
 *   probe needs, and the parsers for what git hands back. `stashes.mts` owns the
 *   two operations that MUTATE (writing an archive ref, dropping a stash) and
 *   the CLI; keeping the reads here means the whole evidence-gathering half can
 *   be exercised without any code that can change the repo being in scope.
 *
 *   Every read is NUL-delimited. A stash subject is free text and a path can
 *   carry a newline, so a line-oriented parse would split one record into two.
 */

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { STASH_ARCHIVE_REF_PREFIX } from './naming.mts'
import type { StashEvidence } from './stash-policy.mts'

export interface StashGitExecOptions {
  // Fed to the child's stdin. The reverse-apply probe needs it: `git apply`
  // reads its patch from stdin, and a patch is far too large for an argv.
  readonly input?: string | undefined
}

export interface StashGitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * A git runner, injected so every function below is testable without a fixture
 * repo. Same seam convention as `GitExec` in `prune.mts`, widened by an
 * optional options bag for stdin and by a captured `stderr`.
 */
export type StashGitExec = (
  args: string[],
  options?: StashGitExecOptions | undefined,
) => Promise<StashGitResult>

/**
 * Spawn git in `cwd`, optionally feeding `input` to its stdin, and capture BOTH
 * output streams.
 *
 * Not `runCapture`: that helper hands the child no stdin, so it cannot serve
 * the reverse-apply probe, and it INHERITS stderr, which is wrong for a lane
 * whose probes provoke failure on purpose. `git ls-files --others` warns about
 * a pathspec directory that no longer exists, and that missing directory is
 * exactly what the probe is asking about — inheriting would print git's warning
 * as though something had gone wrong. Capturing instead lets the callers quote
 * git's own words in the places where a failure genuinely matters.
 *
 * Stdin write errors are swallowed: `git apply` exits as soon as one hunk
 * fails, which closes the pipe while a large patch is still being written and
 * raises EPIPE on a probe that has already answered.
 */
export function runGitCapture(
  args: string[],
  cwd: string,
  options?: StashGitExecOptions | undefined,
): Promise<StashGitResult> {
  const opts = { __proto__: null, ...options } as StashGitExecOptions
  const { input } = opts
  return new Promise((resolve, reject) => {
    const childPromise = spawn('git', args, {
      cwd,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    // v6 lib-stable spawn returns an enriched Promise that rejects on non-zero
    // exit. The exit code IS the answer here, so swallow the rejection rather
    // than let it kill the process.
    void childPromise.catch(() => undefined)
    const child = childPromise.process
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    if (input !== undefined) {
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(input)
    }
    child.on('error', reject)
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr, stdout })
    })
  })
}

/**
 * The production exec: {@link runGitCapture} bound to one repo.
 */
export function stashGitExecFor(repoDir: string): StashGitExec {
  return (args: string[], options?: StashGitExecOptions | undefined) =>
    runGitCapture(args, repoDir, options)
}

export interface StashEntry {
  readonly index: number
  readonly sha: string
  readonly subject: string
  // Commit time as an ISO string, the archive ref name's timestamp half.
  readonly isoDate: string
}

/**
 * Split NUL-delimited git output into non-empty records.
 *
 * `-z` also turns off the quoting git otherwise applies to unusual bytes, so
 * the records come back verbatim.
 */
export function splitNulRecords(stdout: string): string[] {
  const out: string[] = []
  const entries = stdout.split('\0')
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (entry !== '') {
      out.push(entry)
    }
  }
  return out
}

/**
 * Parse `git stash list --format=%gd%x09%H%x09%cI%x09%gs -z` output.
 *
 * The index comes from the record's POSITION, not from parsing `stash@{n}`:
 * position is what `git stash drop` addresses, and the two agree by
 * construction.
 */
export function parseStashList(stdout: string): StashEntry[] {
  const out: StashEntry[] = []
  const records = splitNulRecords(stdout)
  for (let i = 0, { length } = records; i < length; i += 1) {
    const fields = records[i]!.split('\t')
    const sha = fields[1]
    const isoDate = fields[2]
    if (sha === undefined || isoDate === undefined) {
      continue
    }
    out.push({
      index: out.length,
      isoDate,
      sha,
      subject: fields.slice(3).join('\t'),
    })
  }
  return out
}

/**
 * Read one repo's stash list, newest first — the order `git stash list` uses.
 */
export async function readStashList(
  repoDir: string,
  exec: StashGitExec = stashGitExecFor(repoDir),
): Promise<StashEntry[]> {
  const listed = await exec([
    'stash',
    'list',
    '-z',
    '--format=%gd%x09%H%x09%cI%x09%gs',
  ])
  if (listed.code !== 0) {
    throw new Error(
      `cannot read the stash list. Where: ${repoDir}. Saw: ` +
        `\`git stash list\` exit ${String(listed.code)} ` +
        `(${listed.stderr.trim() || 'no stderr'}), wanted 0. Fix: run ` +
        `\`git -C ${repoDir} stash list\` and resolve what it reports.`,
    )
  }
  return parseStashList(listed.stdout)
}

/**
 * Every existing archive ref, keyed by the commit it points at.
 *
 * Keying by commit rather than by ref name is what makes archiving idempotent
 * across naming schemes: a ref written by an earlier pass under any name still
 * proves its stash is archived, so a re-run writes nothing.
 */
export async function readStashArchiveRefs(
  repoDir: string,
  exec: StashGitExec = stashGitExecFor(repoDir),
): Promise<Map<string, string>> {
  const byCommit = new Map<string, string>()
  const listed = await exec([
    'for-each-ref',
    '--format=%(objectname)%09%(refname)',
    STASH_ARCHIVE_REF_PREFIX,
  ])
  if (listed.code !== 0) {
    return byCommit
  }
  const lines = listed.stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const [objectname, refname] = lines[i]!.split('\t')
    if (objectname && refname && !byCommit.has(objectname)) {
      byCommit.set(objectname, refname)
    }
  }
  return byCommit
}

/**
 * The `git stash show` argv listing every path one stash touches.
 *
 * `-u` so carried UNTRACKED files are counted. Without it a stash's untracked
 * half is invisible to every probe, and a file no commit ever held would go out
 * with the stash while the report claimed nothing was at stake.
 */
export function stashTouchedPathsArgs(sha: string): string[] {
  return ['stash', 'show', '-u', '--name-only', '-z', sha]
}

/**
 * The `git stash show` argv for one stash commit's own patch.
 *
 * `-u` for the same reason as above. `--binary` so a binary hunk produces an
 * appliable patch instead of a `Binary files differ` line `git apply` refuses.
 */
export function stashPatchArgs(sha: string): string[] {
  return ['stash', 'show', '-p', '-u', '--binary', sha]
}

/**
 * The `git apply` argv that answers whether a patch reverse-applies to the
 * working tree. `--check` decides without writing anything; `-` reads the patch
 * from stdin.
 */
export function reverseApplyArgs(): string[] {
  return ['apply', '--reverse', '--check', '-']
}

/**
 * The `git ls-files` argv that answers which of `paths` still exist.
 *
 * `--cached --others` covers tracked AND untracked, so a path present but not
 * committed still counts as present. `:(literal)` disables pathspec glob magic,
 * so a path containing `*` or `[` matches itself rather than a pattern. The
 * pathspec also bounds the walk, which keeps `--others` from enumerating
 * `node_modules`.
 */
export function presentPathsArgs(paths: readonly string[]): string[] {
  const args = ['ls-files', '-z', '--cached', '--others', '--']
  for (let i = 0, { length } = paths; i < length; i += 1) {
    args.push(`:(literal)${paths[i]!}`)
  }
  return args
}

/**
 * Gather all three probes for one stash.
 *
 * Every probe runs rather than short-circuiting on the first hit, so a probe
 * that FAILED can never be mistaken for one that passed. A probe that could not
 * run reports `undefined`, which `classifyStashEvidence` reads as blindness.
 */
export async function gatherStashEvidence(
  repoDir: string,
  entry: StashEntry,
  exec: StashGitExec = stashGitExecFor(repoDir),
): Promise<StashEvidence> {
  const base = { index: entry.index, sha: entry.sha, subject: entry.subject }
  const named = await exec(stashTouchedPathsArgs(entry.sha))
  if (named.code !== 0) {
    return {
      ...base,
      presentPaths: undefined,
      reverseApplies: undefined,
      touchedPaths: undefined,
    }
  }
  const touchedPaths = splitNulRecords(named.stdout)
  const patch = await exec(stashPatchArgs(entry.sha))
  let reverseApplies: boolean | undefined
  if (patch.code === 0) {
    const applied = await exec(reverseApplyArgs(), { input: patch.stdout })
    reverseApplies = applied.code === 0
  }
  let presentPaths: readonly string[] | undefined
  if (touchedPaths.length === 0) {
    presentPaths = []
  } else {
    const listed = await exec(presentPathsArgs(touchedPaths))
    if (listed.code === 0) {
      presentPaths = splitNulRecords(listed.stdout)
    }
  }
  return { ...base, presentPaths, reverseApplies, touchedPaths }
}
