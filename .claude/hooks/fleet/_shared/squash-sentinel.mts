// Shared squash-sentinel authorization. The `squashing-history` skill collapses
// history to one commit and force-pushes it — either the whole DEFAULT branch,
// or (via `run.mts --branch <name>`) an author-agreed FEATURE branch down to a
// single commit on its PR base's merge-base. The collapse commit whole-tree
// index, files deleted since the base, and the force-push legitimately trip
// several guards. They all honor the inline `SQUASH_HISTORY=1` sentinel via this
// ONE hardened check (1 path, 1 reference) instead of re-implementing it.
//
// The sentinel authorizes a COMMAND SHAPE, not a branch: the byte-verified
// backup + tree-identity check that makes the collapse safe is performed by the
// engine (`run.mts`) BEFORE it ever emits the sentinel, and the engine is the
// only thing that emits it. So widening the recognized shape to cover the
// feature-branch flow (a fresh collapse commit + a lease-push to a non-default
// branch) does not weaken the guard: the protection is the engine's
// backup+verify, and the push shape below stays lease-only, single-ref.

import { validateHeader } from '../../../../.git-hooks/_shared/commit-format.mts'
import { parseCommands } from './shell-command.mts'

// The exact, full message the squash collapse commit must carry. Anchored
// so a longer message (`chore: initial commit && rm -rf …` smuggled into the
// `-m` value) cannot satisfy it.
const SQUASH_COMMIT_MESSAGE = 'chore: initial commit'

// Push forms that are NEVER part of a squash and could weaponize the
// sentinel into clobbering many refs at once or deleting a branch.
// `--no-verify` is deliberately NOT here: the canonical squash push
// (squashing-history run.mts) carries it by design — SQUASH_HISTORY=1 is the
// documented whole-chain hook exception (CLAUDE.md bypass-phrases), and the
// gated tree is byte-identical to the squashed one being pushed.
const FORBIDDEN_PUSH_FLAGS = new Set([
  '--all',
  '--delete',
  '--mirror',
  '--prune',
  '--tags',
  '-d',
])

// Reads the `-m` / `--message` value out of a parsed git arg list. Supports
// both `-m value`, two tokens, and `--message=value`, one token. Returns
// undefined when no message flag is present.
export function readCommitMessageArg(
  args: readonly string[],
): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]!
    if (a === '--message' || a === '-m') {
      return args[i + 1]
    }
    if (a.startsWith('--message=')) {
      return a.slice('--message='.length)
    }
    if (a.startsWith('-m=')) {
      return a.slice('-m='.length)
    }
  }
  return undefined
}

/**
 * Decide whether an inline `SQUASH_HISTORY=1` sentinel authorizes this exact
 * command. Hardened against malicious bypass: a poisoned prompt must not be
 * able to ride the sentinel to clobber an arbitrary remote, delete refs, or
 * chain extra destructive work.
 *
 * The sentinel is honored ONLY when ALL of these hold. The line must parse to
 * EXACTLY ONE command segment (no `&&` / `;` / `|` chaining and no `$(…)`
 * substitution, which both parse to extra segments); that segment must be a
 * statically-resolved `git` binary (not `$VAR`/eval); the `SQUASH_HISTORY=1`
 * sentinel must be its ONLY inline env assignment (no smuggled
 * `GIT_SSH_COMMAND=…`); and the git subcommand must be one of the squash
 * shapes — a collapse `commit` (the default-branch root `--amend` whose `-m`
 * message is EXACTLY `chore: initial commit`, OR a feature-branch FRESH commit
 * whose `-m` message is a valid Conventional-Commit header), or a `push`
 * carrying `--force` / `--force-with-lease` / `-f` to a bare remote with at
 * most one ref — a plain branch name (any branch, default or feature) or the
 * canonical squash refspec `HEAD:<branch>` (run.mts pushes the squashed
 * detached HEAD onto the target branch that way) — and none of the multi-ref /
 * delete flags in FORBIDDEN_PUSH_FLAGS. Arbitrary `src:dst` refspecs, `:branch`
 * deletes, and globs stay rejected.
 *
 * Any deviation returns false → the command falls through to the normal
 * blocking checks, where it still needs a typed bypass phrase.
 */
export function squashSentinelAllows(command: string): boolean {
  // (1) Sentinel must be present as a structural assignment, confirmed below
  // via the parsed segment's `assignments`. The cheap regex is just a gate.
  if (!/(?:^|\s)SQUASH_HISTORY\s*=\s*1\b/.test(command)) {
    return false
  }
  // (2) The line must parse to EXACTLY ONE command segment. A chain
  // (`&& rm -rf …`), a pipe, or a `$(…)` substitution all yield extra
  // segments — any of those voids the sentinel.
  const segments = parseCommands(command)
  if (segments.length !== 1) {
    return false
  }
  const c = segments[0]!
  // (3) Statically-resolved `git`, never variable/eval-sourced.
  if (c.binary !== 'git' || c.viaVariable || c.viaEval) {
    return false
  }
  // (4) The sentinel must be the sole inline assignment.
  if (
    c.assignments.length !== 1 ||
    !/^SQUASH_HISTORY\s*=\s*1$/.test(c.assignments[0]!)
  ) {
    return false
  }
  const [sub, ...rest] = c.args
  // (5a) Squash collapse commit — LOCAL-only (mutates no remote; the remote is
  // reached solely by the (5b) push), in one of two shapes:
  //   - the default-branch total squash's root AMEND, `-m` message EXACTLY
  //     `chore: initial commit`; or
  //   - a feature-branch squash's FRESH collapse commit (NEVER `--amend` — its
  //     soft-reset target is the shared merge-base with the PR base, which must
  //     not be rewritten), `-m` message a valid Conventional-Commit header (the
  //     branch's PR title). Anchoring the feature message to the
  //     Conventional-Commit shape (the same validator the commit-msg guard
  //     uses) keeps the sentinel from degrading into a blanket `--no-verify`
  //     commit bypass.
  if (sub === 'commit') {
    const msg = readCommitMessageArg(rest)
    if (msg === undefined) {
      return false
    }
    if (rest.includes('--amend')) {
      return msg === SQUASH_COMMIT_MESSAGE
    }
    return msg === SQUASH_COMMIT_MESSAGE || validateHeader(msg).kind === 'ok'
  }
  // (5b) Squash force-push.
  if (sub === 'push') {
    const hasForce = rest.some(
      a => a === '--force' || a === '-f' || a.startsWith('--force-with-lease'),
    )
    if (!hasForce) {
      return false
    }
    if (rest.some(a => FORBIDDEN_PUSH_FLAGS.has(a))) {
      return false
    }
    // Positional (non-flag) args = remote + optional ref. Allow a bare
    // remote with at most one ref: a plain branch name, or the canonical
    // squash refspec `HEAD:<branch>`. Everything else stays rejected —
    // `a:b`, arbitrary refspec, `:branch` (a DELETE: empty src), globs.
    const positionals = rest.filter(a => !a.startsWith('-'))
    if (positionals.length < 1 || positionals.length > 2) {
      return false
    }
    const remote = positionals[0]!
    if (remote.includes(':') || remote.includes('*')) {
      return false
    }
    const ref = positionals[1]
    if (ref === undefined) {
      return true
    }
    if (ref.includes('*')) {
      return false
    }
    if (!ref.includes(':')) {
      return true
    }
    const colonAt = ref.indexOf(':')
    const src = ref.slice(0, colonAt)
    const dst = ref.slice(colonAt + 1)
    return src === 'HEAD' && dst.length > 0 && !dst.includes(':')
  }
  return false
}
