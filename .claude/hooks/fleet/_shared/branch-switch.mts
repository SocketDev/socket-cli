/*
 * @file Shared branch-switch detection + primary-checkout classification for
 *   the two branch-switch guards:
 *
 *   - `primary-checkout-branch-guard` — per-repo (fleet dispatcher) enforcer.
 *   - `no-primary-branch-switch` — its user-global sibling, wired through the
 *     wheelhouse dispatcher so it fires from EVERY repo session. Both block a
 *     `git checkout/switch <branch>` / `-b` / `-c` (and the `-` previous-branch
 *     shorthand) whose effective working tree is the PRIMARY checkout — never a
 *     linked worktree or a submodule — because moving HEAD in a primary
 *     checkout yanks the tree out from under a parallel session. The detection,
 *     classification, effective-directory resolution, the sanctioned
 *     restore-to-default carve-out, and the shared bypass all live here ONCE so
 *     the two guards can never drift. Unified bypass (see
 *     `branchSwitchBypassAllowed`): because BOTH guards fire on a primary
 *     branch-switch, a phrase only one honored would leave the switch
 *     un-bypassable — the other guard would still block. So a single shared
 *     check honors either phrase, human-turn only, and both guards defer to it.
 *     `Allow branch switch` is the canonical shared phrase, and `Allow
 *     primary-branch bypass` is primary-checkout-branch-guard's own.
 */

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { actedOnPath } from './fleet-context.mts'
import { resolveDefaultBranch } from './git-branch.mts'
import type { ToolCallPayload } from './payload.mts'
import { commandsFor } from './shell-command.mts'
import { spawnTimeoutMs } from './spawn-timeout.mts'
import { bypassPhrasePresent } from './transcript.mts'

// Pre-flight substrings the dispatcher gates on: every branch-switch command
// carries the literal `checkout` or `switch` token. Each guard re-declares this
// as its own `export const triggers` literal (the build-time dispatch scanner
// reads that literal textually from each hook's index.mts); this is the single
// canonical value they mirror.
export const BRANCH_SWITCH_TRIGGERS: readonly string[] = ['checkout', 'switch']

// The phrases that authorize a primary branch-switch, honored by BOTH guards.
// `Allow branch switch` is the canonical shared phrase; `Allow primary-branch
// bypass` is primary-checkout-branch-guard's historical phrase, kept so a
// message still advertising it authorizes both guards at once.
export const BRANCH_SWITCH_BYPASS_PHRASES: readonly string[] = [
  'Allow branch switch',
  'Allow primary-branch bypass',
]

/**
 * True when the user typed either unified bypass phrase in a genuine human
 * turn (bypassPhrasePresent — not the assistant, a tool result, or a
 * peer-agent relay). Both guards call this so a primary switch is never left
 * un-bypassable by one guard honoring a phrase the other ignores.
 */
export function branchSwitchBypassAllowed(payload: ToolCallPayload): boolean {
  return bypassPhrasePresent(
    payload.transcript_path,
    BRANCH_SWITCH_BYPASS_PHRASES,
  )
}

// A `git checkout` arg list that's a working-tree / file restore rather than a
// branch switch: `git checkout -- <file>` or `git checkout .`. Conservative —
// anything ambiguous is treated as a branch (the guard is about NOT moving
// HEAD in the primary checkout).
export function looksLikePathRestore(args: readonly string[]): boolean {
  return args.includes('--') || args.includes('.')
}

// A ref that moves HEAD: a normal branch/commit name, no leading dash, or the
// `-` shorthand for the previous branch (`git checkout -` / `git switch -`).
// Without the `-` case, the previous-branch switch slips past the flag filter.
export function isSwitchTarget(arg: string): boolean {
  return arg === '-' || !arg.startsWith('-')
}

/**
 * Inspect a single `git` command's args; return the branch operation it
 * performs, or undefined if it's not a branch create/switch.
 */
export function branchOpKind(
  args: readonly string[],
): 'create' | 'switch' | undefined {
  const sub = args.find(a => a === 'checkout' || a === 'switch')
  if (!sub) {
    return undefined
  }
  const rest = args.slice(args.indexOf(sub) + 1)
  // Create-and-switch flags on either subcommand.
  if (
    rest.includes('-b') ||
    rest.includes('-B') ||
    rest.includes('-c') ||
    rest.includes('-C')
  ) {
    return 'create'
  }
  if (sub === 'switch') {
    // `git switch <name>` (or `git switch -`) — moving to another branch. A
    // bare `git switch` with only flags has no target → ignore.
    const target = rest.find(isSwitchTarget)
    return target ? 'switch' : undefined
  }
  // sub === 'checkout': a branch switch only when there's a target arg that
  // isn't a file-restore form. `--`/`.` guards the file-restore case, so a lone
  // `-` here is the previous-branch shorthand, not a filename.
  if (looksLikePathRestore(rest)) {
    return undefined
  }
  const target = rest.find(isSwitchTarget)
  return target ? 'switch' : undefined
}

// The three checkout shapes a `git rev-parse --git-dir` result can name. A
// linked worktree resolves under `.git/worktrees/<name>`, a submodule under
// `.git/modules/<name>`, and everything else is the repo's own `.git`.
export type CheckoutKind = 'primary' | 'submodule' | 'worktree'

// True when the git-dir sits in `<repo>/.git/<sub>/…`. Both the absolute form
// git reports from a worktree or submodule and the relative `.git` form it
// reports from a repo root are accepted, so the classifier never depends on
// which of the two git chose.
function gitDirHasSubtree(gitDir: string, sub: string): boolean {
  const p = normalizePath(gitDir)
  return p.includes(`/.git/${sub}/`) || p.startsWith(`.git/${sub}/`)
}

/**
 * Classify a `git rev-parse --git-dir` result. A SUBMODULE is its own case: its
 * git-dir lives under the superproject's `.git/modules/`, which contains
 * neither `/.git/worktrees/` nor a plain repo `.git`, so a two-case
 * primary-vs-worktree test answers "primary" and blocks the detached checkout
 * the upstream-references doctrine requires (`git -C upstream/<name> checkout
 * --detach <ref>` is how a gitlink-less reference is pinned).
 */
export function checkoutKindForGitDir(gitDir: string): CheckoutKind {
  if (gitDirHasSubtree(gitDir, 'worktrees')) {
    return 'worktree'
  }
  if (gitDirHasSubtree(gitDir, 'modules')) {
    return 'submodule'
  }
  return 'primary'
}

/**
 * True when `cwd` is the PRIMARY checkout — neither a linked worktree nor a
 * submodule. Branch work in a worktree is the sanctioned path, and a submodule
 * checkout is a different repository entirely, so neither is the guards'
 * business. Fails OPEN (returns false) when git is unavailable / not a repo.
 */
export function isPrimaryCheckout(cwd: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    // Not a git repo, or git unavailable — nothing to guard, fail open.
    return false
  }
  return checkoutKindForGitDir(String(r.stdout).trim()) === 'primary'
}

// `git -C <path> ...` runs the subcommand in <path>. Extract that path so a
// branch op aimed at the primary via `-C` is judged by the target, not the
// possibly worktree, session cwd.
function dashCDir(args: readonly string[]): string | undefined {
  const i = args.indexOf('-C')
  if (i < 0 || i + 1 >= args.length) {
    return undefined
  }
  // An empty value means `-C` WAS present but its path did not survive parsing:
  // `git -C $u checkout …`, where the shell parser cannot expand the variable.
  // Report undefined so callers can tell that apart from "no -C given" via
  // `hasDashC`. Conflating the two re-aims the guard at the session cwd, which
  // is the primary checkout — the exact repo the `-C` was pointing away from.
  const target = args[i + 1]
  return target ? target : undefined
}

// True when the argv carries a `-C <path>` at all, whether or not the path
// survived parsing. Paired with `dashCDir` so an unreadable path is
// distinguishable from an absent one.
export function hasDashC(args: readonly string[]): boolean {
  const i = args.indexOf('-C')
  return i >= 0 && i + 1 < args.length
}

// The ref a branch op moves HEAD to: the name after `-b/-B/-c/-C` for a create,
// else the pathspec-less positional target of a switch/checkout. Used to carve
// out switching TO the default branch (always safe — it's the sanctioned state).
export function branchTarget(args: readonly string[]): string | undefined {
  const sub = args.find(a => a === 'checkout' || a === 'switch')
  if (!sub) {
    return undefined
  }
  const rest = args.slice(args.indexOf(sub) + 1)
  for (const flag of ['-b', '-B', '-c', '-C']) {
    const i = rest.indexOf(flag)
    if (i >= 0 && i + 1 < rest.length) {
      return rest[i + 1]
    }
  }
  if (looksLikePathRestore(rest)) {
    return undefined
  }
  return rest.find(isSwitchTarget)
}

export interface BranchOp {
  readonly kind: 'create' | 'switch'
  readonly dashC?: string | undefined
  // `-C` was present but its path did not survive parsing (a shell variable).
  // The op targets SOME other repo; which one is unknowable statically.
  readonly dashCUnreadable?: boolean | undefined
  readonly target?: string | undefined
}

/**
 * The first `git checkout`/`switch` segment of `command` that MOVES HEAD, with
 * its `-C` target and the ref it moves to — or undefined when the command runs
 * no branch op. Sees through `&&` chains / quoting / `$(…)` substitution via
 * the shared shell parser (commandsFor), so a literal "git checkout" in a grep
 * string never false-fires.
 */
export function firstBranchOp(command: string): BranchOp | undefined {
  for (const c of commandsFor(command, 'git')) {
    const kind = branchOpKind(c.args)
    if (kind) {
      const dashC = dashCDir(c.args)
      const target = branchTarget(c.args)
      const dashCUnreadable = dashC === undefined && hasDashC(c.args)
      return {
        kind,
        ...(dashC === undefined ? {} : { dashC }),
        ...(dashCUnreadable ? { dashCUnreadable } : {}),
        ...(target === undefined ? {} : { target }),
      }
    }
  }
  return undefined
}

export interface PrimaryBranchOp {
  // The effective working directory the branch op targets (a subshell `cd`,
  // then a `-C <path>` relative to it).
  readonly dir: string
  readonly kind: 'create' | 'switch'
  readonly target: string | undefined
}

/**
 * The branch op in `command` that BOTH guards act on: one that moves HEAD in a
 * PRIMARY checkout and is NOT the sanctioned restore-to-default. Returns the op
 * \+ its effective directory, or undefined when there is no branch op, the
 * target is a linked worktree / submodule / non-repo, or it is a switch TO the
 * default branch (always safe — the sanctioned state that
 * primary-checkout-on-default-stop-guard REQUIRES; blocking it would deadlock
 * the two guards).
 *
 * Effective dir: honor a subshell `cd` (actedOnPath), THEN a `-C <path>` on the
 * git op relative to that — a worktree cwd cannot launder a switch aimed at the
 * primary via `-C`.
 */
export function primaryBranchOp(
  command: string,
  payload: ToolCallPayload,
): PrimaryBranchOp | undefined {
  const op = firstBranchOp(command)
  if (!op) {
    return undefined
  }
  // A `-C` whose path did not survive parsing (a shell variable) means the op
  // aims at a repo we cannot name. Falling back to the session cwd here would
  // judge the PRIMARY checkout — the one repo the `-C` was pointing away from —
  // and block a legitimate elsewhere-op. The upstream-references flow is the
  // case that bit: `git -C $u checkout --detach <pin>` against a vendored
  // reference read as a primary branch switch. Passing an explicit `-C` is
  // itself the statement that the primary is not the target.
  if (op.dashCUnreadable) {
    return undefined
  }
  const baseCwd = actedOnPath(payload)
  const dir = op.dashC ? path.resolve(baseCwd, op.dashC) : baseCwd
  if (!isPrimaryCheckout(dir)) {
    return undefined
  }
  if (op.kind === 'switch' && op.target === resolveDefaultBranch(dir)) {
    return undefined
  }
  return { dir, kind: op.kind, target: op.target }
}
