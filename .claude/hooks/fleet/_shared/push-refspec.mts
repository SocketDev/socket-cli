/*
 * @file Parse a `git push` command's refspecs to decide whether the push WRITES
 *   a protected branch (`main` / `master`) on the remote. Shared by
 *   `push-protected-branch-guard` (the agent-side block) and its tests so the
 *   two reason about a refspec identically and never drift.
 *   Why a dedicated parser: a `git push` updates a remote ref, and the ref it
 *   updates is encoded in a refspec that has many spellings — a bare branch
 *   (`main`), a `src:dst` pair (`HEAD:main`, `<sha>:refs/heads/main`), a
 *   force-prefixed `+main`, a delete (`:main`), and the implicit case (bare
 *   `git push` with no refspec, which targets the current branch's upstream).
 *   Regex-matching `main` anywhere in the command line is wrong in both
 *   directions: it misses `HEAD:refs/heads/main` (no bare `main` token) and
 *   false-fires on `git push origin feature/main-rewrite`. So we tokenize via
 *   the fleet shell parser and read the DESTINATION ref out of each refspec.
 *   Detection model (per command segment whose binary is `git` and whose first
 *   non-flag arg is `push`):
 *
 *   - Walk the args after `push`. Skip flags. The FIRST non-flag arg is the
 *     remote; every subsequent non-flag arg is a refspec.
 *   - For each refspec: strip a leading `+` (force), take the part after the last
 *     `:` as the destination (a colon-less refspec is its own destination; a
 *     `:dst` delete still names `dst`), strip a `refs/heads/` / `refs/` prefix,
 *     and compare the leaf to `main` / `master`.
 *   - `HEAD` (bare, or as a destination) and the no-refspec case resolve to the
 *     repo's CURRENT branch via the caller-supplied resolver — a bare `git
 *     push` on a `main`-tracking checkout is the canonical incident.
 *     Conservative by construction: a destination we can't classify is treated
 *     as NON-protected (the guard fails open — see its header), so the only
 *     refspecs that trip the block are ones that unambiguously name `main` /
 *     `master`.
 */

import { commandsFor } from './shell-command.mts'

// The remote branches this guard treats as protected. Exact, case-sensitive
// leaf match — git branch names are case-sensitive, and `Main` is not `main`.
export const PROTECTED_BRANCHES: readonly string[] = ['main', 'master']

// `git push` flags that take a SEPARATE-WORD value, so the following token is
// that value (a count, a repo name, a refname) and must NOT be read as the
// remote or a refspec. The `--flag=value` forms are self-contained and handled
// by the generic flag skip. `--force-with-lease` is deliberately absent: git
// only accepts its value ATTACHED (`--force-with-lease[=<ref>[:<expect>]]`),
// never as a separate word — listing it made `git push --force-with-lease
// origin main` consume `origin` and mis-read `main` as the remote, hiding the
// destination from the protected-branch check.
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--exec',
  '--push-option',
  '--receive-pack',
  '--repo',
  '-o',
])

/**
 * The destination branch a single refspec writes, normalized to its leaf name
 * (so `refs/heads/main` → `main`), or undefined when the refspec names no
 * branch (e.g. a tag refspec, or an unparseable token). `HEAD` is returned
 * verbatim so the caller can resolve it against the current branch.
 */
export function refspecDestination(refspec: string): string | undefined {
  if (!refspec) {
    return undefined
  }
  // Strip a leading force marker. `+main` and `main` write the same ref.
  const spec = refspec.startsWith('+') ? refspec.slice(1) : refspec
  // `src:dst` → destination is the part after the LAST colon. A leading-colon
  // delete (`:main`) yields `main` (deleting a protected branch is still a
  // protected-branch write we want to gate). A colon-less refspec is its own
  // destination.
  const colon = spec.lastIndexOf(':')
  let dst = colon === -1 ? spec : spec.slice(colon + 1)
  if (!dst) {
    return undefined
  }
  // `HEAD` is resolved by the caller against the current branch.
  if (dst === 'HEAD') {
    return 'HEAD'
  }
  // Normalize a fully-qualified ref to its branch leaf: refs/heads/main → main.
  // A non-branch fully-qualified ref (refs/tags/…, refs/notes/…) is NOT a
  // branch write — return undefined so it never trips the protected check.
  if (dst.startsWith('refs/')) {
    if (dst.startsWith('refs/heads/')) {
      dst = dst.slice('refs/heads/'.length)
    } else {
      return undefined
    }
  }
  return dst
}

/**
 * What a single `git push` arg list (the args AFTER `push`) writes:
 *
 * - `destinations` — every refspec destination that names a branch, leaf-
 *   normalized (`refs/heads/main` → `main`, `HEAD` verbatim for the caller).
 * - `hadRefspec` — true when ANY positional token followed the remote (a branch
 *   refspec, a `tag <name>` pair, or an unparseable token). This is the
 *   distinction the bare-push fallback needs: a TRULY refspec-less push (`git
 *   push`, `git push origin`) resolves the current branch, but a push that
 *   named a non-branch ref (`git push origin tag v1.0`) must NOT — it targets
 *   that ref, not the current branch.
 */
export interface PushTargets {
  readonly destinations: readonly string[]
  readonly hadRefspec: boolean
}

export function pushDestinations(pushArgs: readonly string[]): PushTargets {
  const destinations: string[] = []
  let sawRemote = false
  let hadRefspec = false
  let pendingTagKeyword = false
  for (let i = 0, { length } = pushArgs; i < length; i += 1) {
    const arg = pushArgs[i]!
    if (arg.startsWith('-')) {
      // A separate-word value flag consumes the next token.
      if (VALUE_FLAGS.has(arg)) {
        i += 1
      }
      continue
    }
    // `git push <remote> tag <name>` — the `tag` keyword marks the next token
    // as a TAG ref, never a branch. Consume both without recording a branch,
    // but the push DID name a refspec, so no current-branch fallback.
    if (pendingTagKeyword) {
      pendingTagKeyword = false
      continue
    }
    if (!sawRemote) {
      sawRemote = true
      continue
    }
    hadRefspec = true
    if (arg === 'tag') {
      pendingTagKeyword = true
      continue
    }
    const dst = refspecDestination(arg)
    if (dst !== undefined) {
      destinations.push(dst)
    }
  }
  return { destinations, hadRefspec }
}

/**
 * Result of inspecting a command for a protected-branch push.
 */
export interface ProtectedPush {
  // The destination branch that tripped the check (`main` / `master`).
  readonly branch: string
  // The remote it would be pushed to, when resolvable (else undefined).
  readonly remote: string | undefined
}

/**
 * The remote named in a `git push` arg list (the first non-flag, non-value-flag
 * arg after `push`), or undefined for a bare `git push`.
 */
export function pushRemote(pushArgs: readonly string[]): string | undefined {
  for (let i = 0, { length } = pushArgs; i < length; i += 1) {
    const arg = pushArgs[i]!
    if (arg.startsWith('-')) {
      if (VALUE_FLAGS.has(arg)) {
        i += 1
      }
      continue
    }
    return arg
  }
  return undefined
}

/**
 * Inspect a Bash `command` for a `git push` that WRITES a protected branch.
 * Returns the offending push (branch + remote) or undefined when no segment
 * pushes a protected branch.
 *
 * `resolveCurrentBranch(repoDir)` is called only when a refspec is `HEAD` or
 * the push has no explicit refspec (bare `git push`) — it returns the repo's
 * current branch name (or undefined when detached / unresolvable). `gitCwd` is
 * the directory the git command runs in (resolved by the caller).
 *
 * Pure except for the injected resolver, so tests can drive it with a fake
 * resolver and never touch a real repo.
 */
export function findProtectedBranchPush(
  command: string,
  gitCwd: string,
  resolveCurrentBranch: (repoDir: string) => string | undefined,
): ProtectedPush | undefined {
  const protectedSet = new Set(PROTECTED_BRANCHES)
  const gitCommands = commandsFor(command, 'git')
  for (let c = 0, { length } = gitCommands; c < length; c += 1) {
    const args = gitCommands[c]!.args
    // First non-flag arg must be `push` (skip `-C <dir>` / `-c k=v` globals).
    if (!isPushInvocation(args)) {
      continue
    }
    const pushArgs = args.slice(args.indexOf('push') + 1)
    const remote = pushRemote(pushArgs)
    const { destinations, hadRefspec } = pushDestinations(pushArgs)
    // No explicit refspec at all → bare push to the current branch's upstream.
    // The canonical incident: `git push` on a checkout that tracks origin/main.
    // A push that DID name a refspec (even a non-branch one like `tag v1.0`)
    // does NOT fall back to the current branch — it targets the named ref.
    if (!hadRefspec) {
      const current = resolveCurrentBranch(gitCwd)
      if (current && protectedSet.has(current)) {
        return { branch: current, remote }
      }
      continue
    }
    for (let d = 0, dlen = destinations.length; d < dlen; d += 1) {
      let branch = destinations[d]!
      if (branch === 'HEAD') {
        const current = resolveCurrentBranch(gitCwd)
        if (!current) {
          continue
        }
        branch = current
      }
      if (protectedSet.has(branch)) {
        return { branch, remote }
      }
    }
  }
  return undefined
}

/**
 * True when `args` (a git command's args, after any `-C`/`-c` globals) invokes
 * the `push` subcommand. `push` must be the first NON-flag, non-value token —
 * so `git push …` and `git -C /x push …` match, while `git log --grep push`
 * does not (push there is a flag VALUE / appears after the real subcommand
 * `log`).
 */
export function isPushInvocation(args: readonly string[]): boolean {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === '-C' || arg === '-c') {
      // Skip the global flag and its value.
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      continue
    }
    return arg === 'push'
  }
  return false
}
