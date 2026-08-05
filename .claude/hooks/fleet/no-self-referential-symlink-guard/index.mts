#!/usr/bin/env node
/*
 * @file Claude Code PreToolUse(Bash) guard — blocks a `git add` that would
 *   stage a symlink git must never carry, or any `node_modules` path.
 *
 *   The incident this exists for: a cascade worktree symlinked `node_modules`
 *   at an absolute machine path so tests could run, then a `git add -A` staged
 *   the LINK (mode 120000). `.gitignore` said `node_modules/` — a trailing
 *   slash matches a DIRECTORY, and a symlink is a file to git — so the ignore
 *   rule missed it entirely. It was committed and pushed; in CI the target does
 *   not exist, `mkdirSync(path, { recursive: true })` on a dangling link throws
 *   `ENOENT`, and the pre-install bootstrap died on a public repo. An earlier
 *   variant of the same shape (a self-loop) broke `pnpm install` fleet-wide
 *   with `ELOOP`.
 *
 *   Three offences, all shared with the commit-time `tracked-symlinks-are-safe`
 *   check through `scripts/fleet/lib/self-referential-symlink.mts` so the two
 *   layers cannot drift:
 *
 *   1. A symlink whose target resolves to its own path, or to an ancestor that
 *      contains it — any looping link, not just `node_modules`.
 *   2. A symlink whose target is an ABSOLUTE path inside the repo: it encodes
 *      one machine's layout and is loop-prone. An intra-repo link is relative.
 *   3. ANY `node_modules` path, symlink or not. It is gitignored; tracking it
 *      at all is the bug.
 *
 *   Literal-argument matching would NOT have caught the incident, which was
 *   `git add -A`. So the guard asks git what the command would actually stage —
 *   `git add --dry-run` with the same pathspecs, which prints repo-root-relative
 *   paths and touches no index — then reads each entry's link body off the
 *   worktree. When git can't answer (not a repo, git missing, a bad pathspec)
 *   it falls back to the literal path arguments and otherwise fails OPEN.
 *
 *   Deliberately NOT relaxed for squash-history repos or the `FLEET_SYNC=1`
 *   cascade sentinel, the two escape hatches `overeager-staging-guard` honors:
 *   the incident WAS a cascade broad-add, and unlike a staging-etiquette
 *   complaint this defect survives into every fresh clone.
 *
 *   Relative symlinks pointing outside their own subtree are legitimate and
 *   several fleet repos track them — those always pass.
 *
 *   Bypass: `Allow self-referential-symlink bypass`.
 */

import { lstatSync, readlinkSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
// oxlint-disable-next-line socket/prefer-async-spawn -- a PreToolUse guard returns its verdict synchronously; git must answer inline.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { extractGitCwd } from '../_shared/git-cwd.mts'
import { splitGitSubcommand } from '../_shared/git-subcommand.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { classifyStagedPath } from '../../../../scripts/fleet/lib/self-referential-symlink.mts'
import type { BadSymlink } from '../../../../scripts/fleet/lib/self-referential-symlink.mts'

// Dispatcher pre-flight: every block path starts at `commandsFor(command,
// 'git')`, which short-circuits unless the raw command mentions `git`. A
// command without it can never block, so the dispatcher skips this guard.
export const triggers: readonly string[] = ['git']

// `git add` modes that open an interactive session. git REFUSES to pair them
// with `--dry-run` ("--dry-run is incompatible with --interactive/--patch"), so
// probing would only burn a spawn. An agent never issues them either.
const INTERACTIVE_ADD_FLAGS: ReadonlySet<string> = new Set([
  '--edit',
  '--interactive',
  '--patch',
  '-e',
  '-i',
  '-p',
])

// `git add` options that swallow the NEXT token as their value, so the token
// after them is not a pathspec. The `=`-joined spellings need no entry — they
// are single tokens the flag branch already skips.
const ADD_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--chmod',
  '--pathspec-from-file',
])

/**
 * The `add` argument lists in a command — one per `git add` segment, holding
 * only the args AFTER the subcommand. `git -C dir add -A` yields `['-A']`; a
 * `git commit` or `git -C add status` (a directory NAMED `add`) yields nothing.
 * Pure.
 */
export function gitAddArgLists(command: string): string[][] {
  const out: string[][] = []
  for (const c of commandsFor(command, 'git')) {
    const { rest, sub } = splitGitSubcommand(c.args)
    if (sub === 'add') {
      out.push([...rest])
    }
  }
  return out
}

/**
 * The positional pathspecs in an `add` argument list. Everything after a `--`
 * separator is a path regardless of shape; before it, flags and the values they
 * consume are skipped. Pure.
 */
export function addPathspecs(addArgs: readonly string[]): string[] {
  const out: string[] = []
  let sawSeparator = false
  for (let i = 0, { length } = addArgs; i < length; i += 1) {
    const arg = addArgs[i]!
    if (sawSeparator) {
      out.push(arg)
      continue
    }
    if (arg === '--') {
      sawSeparator = true
      continue
    }
    if (arg.startsWith('-')) {
      if (ADD_VALUE_FLAGS.has(arg)) {
        i += 1
      }
      continue
    }
    out.push(arg)
  }
  return out
}

/**
 * True when the argument list opens an interactive add, which cannot be
 * dry-run. Pure.
 */
export function isInteractiveAdd(addArgs: readonly string[]): boolean {
  return addArgs.some(a => INTERACTIVE_ADD_FLAGS.has(a))
}

/**
 * Repo-root-relative paths from `git add --dry-run` output. git prints one
 * `add '<path>'` line per entry it would stage (and `remove '<path>'` for a
 * deletion, which stages nothing dangerous and is skipped). Pure.
 */
export function parseDryRunPaths(stdout: string): string[] {
  const out: string[] = []
  const lines = stdout.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = /^add '(.*)'$/.exec(lines[i]!.trim())
    if (m) {
      out.push(m[1]!)
    }
  }
  return out
}

/**
 * A would-be-staged worktree entry: its repo-relative path, plus the link body
 * when it is a symlink (`undefined` for a regular file or directory).
 */
export interface StagedEntry {
  readonly path: string
  readonly target: string | undefined
}

/**
 * Classify every would-be-staged entry against the shared rule. Pure —
 * the filesystem read happens in `readStagedEntries`, so the decision logic
 * unit-tests without a fixture tree.
 */
export function findOffenders(
  entries: readonly StagedEntry[],
  repoRoot: string,
): BadSymlink[] {
  const out: BadSymlink[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const verdict = classifyStagedPath(entry.path, entry.target, repoRoot)
    if (verdict) {
      out.push(verdict)
    }
  }
  return out
}

// The link body of `abs`, or undefined when it is not a symlink / unreadable.
// lstat + readlink both work on a DANGLING link, which is exactly the incident's
// shape — the target did not exist on the machine that read it.
function readLinkTarget(abs: string): string | undefined {
  try {
    if (!lstatSync(abs).isSymbolicLink()) {
      return undefined
    }
    return readlinkSync(abs)
  } catch {
    return undefined
  }
}

function readStagedEntries(
  repoRoot: string,
  paths: readonly string[],
): StagedEntry[] {
  const out: StagedEntry[] = []
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const p = paths[i]!
    out.push({ path: p, target: readLinkTarget(path.join(repoRoot, p)) })
  }
  return out
}

// The absolute repo root for `dir`, or undefined when it is not a git repo.
function repoRootOf(dir: string): string | undefined {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir,
    stdioString: true,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    return undefined
  }
  const out = String(r.stdout ?? '').trim()
  return out ? normalizePath(out) : undefined
}

// What the command would actually stage. `--dry-run` writes nothing, and git
// prints paths relative to the REPO ROOT even when invoked from a subdirectory,
// so the result needs no re-rooting. `core.quotePath=false` keeps non-ASCII
// names from arriving octal-escaped. Undefined when git could not answer.
function dryRunStagedPaths(
  dir: string,
  addArgs: readonly string[],
): string[] | undefined {
  const r = spawnSync(
    'git',
    ['-c', 'core.quotePath=false', 'add', '--dry-run', ...addArgs],
    { cwd: dir, stdioString: true, timeout: spawnTimeoutMs(10_000) },
  )
  if (r.status !== 0) {
    return undefined
  }
  return parseDryRunPaths(String(r.stdout ?? ''))
}

export function checkCommand(command: string, cwd: string | undefined) {
  const argLists = gitAddArgLists(command)
  if (argLists.length === 0) {
    return undefined
  }
  const dir = extractGitCwd(command, { cwd, subcommand: ['add'] })
  // No repo means no staging to guard, and no root to judge a target against.
  const repoRoot = repoRootOf(dir) ?? normalizePath(dir)

  const offenders: BadSymlink[] = []
  const seen = new Set<string>()
  for (let i = 0, { length } = argLists; i < length; i += 1) {
    const addArgs = argLists[i]!
    if (isInteractiveAdd(addArgs)) {
      continue
    }
    // Literal pathspecs are the fallback, not the primary read: `git add -A`
    // has none, and that is the command the incident used.
    const staged = dryRunStagedPaths(dir, addArgs) ?? addPathspecs(addArgs)
    const entries = readStagedEntries(repoRoot, staged)
    const found = findOffenders(entries, repoRoot)
    for (let j = 0, { length: len } = found; j < len; j += 1) {
      const bad = found[j]!
      if (!seen.has(bad.linkPath)) {
        seen.add(bad.linkPath)
        offenders.push(bad)
      }
    }
  }
  if (offenders.length === 0) {
    return undefined
  }

  return block(
    [
      '[no-self-referential-symlink-guard] Blocked: this `git add` would stage a path git must never carry.',
      '',
      ...offenders
        .slice(0, 20)
        .map(o =>
          o.target
            ? `    ${o.linkPath} → ${o.target}  (${o.reason})`
            : `    ${o.linkPath}  (${o.reason})`,
        ),
      ...(offenders.length > 20
        ? [`    … and ${offenders.length - 20} more`]
        : []),
      '',
      '  A tracked symlink overrides .gitignore and follows the commit into',
      '  every clone. On another machine the target is absent, so the link',
      '  dangles: `mkdirSync(p, { recursive: true })` throws ENOENT and CI',
      '  bootstrap dies. A looping link aborts `pnpm install` with ELOOP.',
      '',
      '  Fix — pick the one that matches:',
      '    node_modules  → never stage it. Make .gitignore match the LINK too:',
      '                    `**/node_modules`, not `node_modules/` (a trailing',
      '                    slash matches a directory, and a symlink is a file).',
      '    absolute link → replace it with a RELATIVE target.',
      '    looping link  → point it outside its own subtree, or delete it.',
      '',
      '  Then stage by explicit path rather than re-running the broad add.',
      '',
    ].join('\n'),
  )
}

export const check = bashGuard((command, payload) =>
  checkCommand(command, payload.cwd),
)

export const hook = defineHook({
  bypass: ['self-referential-symlink'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
