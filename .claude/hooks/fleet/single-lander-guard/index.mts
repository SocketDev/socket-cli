#!/usr/bin/env node
// Claude Code PreToolUse hook — single-lander-guard.
//
// BLOCKS two shapes of destructive git op that entangle a repo's live tree
// when more than one lander touches it at once. One lander per repo.
//
// (A) STALE-STASH. A blind `git stash pop` / `git stash apply` — no explicit
//     `stash@{N}` and no other `<stash>` argument — pops stash@{0}, which in a
//     shared checkout may be ANOTHER session's stash, not yours. The fix is to
//     capture your own ref when you push and pop THAT explicit ref.
//
// (B) CONCURRENT-LAND. A destructive land op — `git merge`, `git rebase`,
//     `git reset --hard`, `git cherry-pick`, or a `git stash pop` / `apply` —
//     run while `<repo>/.git` holds an `index.lock`. The lock means another git
//     process is mid-operation; piling on races the lock and can entangle the
//     live tree. Wait for the other op / let the single armed lander finish.
//
// WHY. A background land-watcher armed to merge branches onto main the
// instant the co-session primary goes clean can fire in the same window as a
// MANUAL land. Both race on .git/index.lock: the manual `git stash push`
// fails on the lock, but the script still runs a blind `git stash pop`,
// which pops stash@{0} — a STALE co-session stash — into the live tree,
// leaving UU conflict markers in workspace files. This guard makes both
// halves of that impossible at the Bash layer, so NO path — script, loop, or
// manual — can blind-pop or pile a destructive land onto a repo with an
// active git process.
//
// The decision is a PURE function, decideLandGuard, over the parsed command +
// an index-lock fact, so it is exhaustively unit-tested without touching the
// filesystem. The wrapper resolves the real repo dir from the command and stats
// <repo>/.git/index.lock to supply that fact.
//
// Detection is AST-parsed via commandsFor, robust to leading env assignments,
// `git -C <path>`, quoting, and `&&` / `;` chains — each git segment is judged.
//
// Does NOT fire when:
//   - the context is CI — CI / GITHUB_ACTIONS / CONTINUOUS_INTEGRATION set. CI
//     runs one job with no rival session, and a hung index.lock there is a
//     crashed step to clear, not a live-tree race.
//   - the acted-on repo is not fleet-managed — scope 'convention' stands the
//     hook down in a foreign repo.
//   - a stash pop / apply carries an explicit ref AND no index.lock is present.
//
// Bypass: `Allow single-lander bypass` typed verbatim in a recent user turn.
//
// Fails open on parse / payload errors — a guard bug must not wedge every Bash
// call.

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { extractGitCwd } from '../_shared/git-cwd.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// Pre-flight skip hint: detection only fires when the `git` binary is invoked.
export const triggers: readonly string[] = ['git']

// Stable identifier for CI scripts / ndjson reporters to branch on instead of
// substring-matching the human message.
export const ERR_SINGLE_LANDER = 'ERR_FLEET_SINGLE_LANDER'

// `git` global options that consume the FOLLOWING token as their value, so the
// subcommand scan skips both. Everything else before the subcommand is either a
// boolean global flag — `--no-pager`, `--bare` — or a `--flag=value` form, each
// a single token.
const GLOBAL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--work-tree',
  '-C',
  '-c',
])

// The destructive-land subcommands whose bare form — any invocation — counts,
// independent of flags. `reset` is handled separately: only `--hard` qualifies.
const LAND_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'cherry-pick',
  'merge',
  'rebase',
])

/**
 * The rule a block verdict fired on. Kept in the pure decision so the message
 * formatter — and unit tests — can branch without re-parsing.
 */
export type LandGuardRule = 'concurrent-land' | 'stale-stash'

/**
 * The single filesystem fact the pure decision needs: whether another git
 * process holds the repo's index lock right now.
 */
export interface LandGuardCtx {
  readonly indexLockPresent: boolean
}

/**
 * A land-guard verdict. `blocked: false` allows; a block carries the rule that
 * fired and a human label for the offending op — `git merge`, `git stash pop`.
 */
export interface LandGuardDecision {
  readonly blocked: boolean
  readonly op?: string | undefined
  readonly rule?: LandGuardRule | undefined
}

const ALLOW: LandGuardDecision = { blocked: false }

interface GitSegment {
  readonly rest: readonly string[]
  readonly sub: string | undefined
}

// The subcommand of a parsed `git` invocation plus the args after it, skipping
// leading global options — and the value token of a value-taking global flag —
// so `git -C /x merge` resolves to sub `merge`.
function gitSegment(args: readonly string[]): GitSegment {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (!arg.startsWith('-')) {
      return { rest: args.slice(i + 1), sub: arg }
    }
    if (GLOBAL_VALUE_FLAGS.has(arg)) {
      // Skip the flag AND its separate-word value.
      i += 1
    }
    // A `--flag=value` or boolean global flag is a single token — fall through.
  }
  return { rest: [], sub: undefined }
}

interface StashAction {
  readonly action: 'apply' | 'pop' | undefined
  readonly hasExplicitRef: boolean
}

const NO_STASH: StashAction = { action: undefined, hasExplicitRef: false }

// A `git stash pop|apply` classification: the action, and whether an explicit
// `<stash>` ref — a `stash@{N}`, a numeric index, or any non-flag positional —
// was supplied. Absent an explicit ref, pop/apply act on stash@{0}.
function stashAction(seg: GitSegment): StashAction {
  if (seg.sub !== 'stash') {
    return NO_STASH
  }
  const action = seg.rest[0]
  if (action !== 'apply' && action !== 'pop') {
    return NO_STASH
  }
  const hasExplicitRef = seg.rest.slice(1).some(arg => !arg.startsWith('-'))
  return { action, hasExplicitRef }
}

// The human label for a destructive-land op in this segment, or undefined when
// the segment is not a land op. Shared by the concurrent-land rule.
function landOpLabel(seg: GitSegment, stash: StashAction): string | undefined {
  if (seg.sub !== undefined && LAND_SUBCOMMANDS.has(seg.sub)) {
    return `git ${seg.sub}`
  }
  if (seg.sub === 'reset' && seg.rest.includes('--hard')) {
    return 'git reset --hard'
  }
  if (stash.action) {
    return `git stash ${stash.action}`
  }
  return undefined
}

/**
 * Decide whether a Bash `command` must be blocked as an unsafe land op. Pure:
 * the only external fact is `ctx.indexLockPresent`. Evaluates EACH `git`
 * segment of a chained command.
 *
 * (A) STALE-STASH wins first: a `git stash pop|apply` with no explicit
 * `<stash>` ref is blocked regardless of the lock — it pops stash@{0}, possibly
 * a rival session's. (B) CONCURRENT-LAND: any destructive land op — `git merge`
 * / `git rebase` / `git reset --hard` / `git cherry-pick` / `git stash
 * pop|apply` — is blocked when `ctx.indexLockPresent` is true.
 *
 * Everything else allows: read-only git — status/log/diff/show — a land op with
 * NO lock present, and a stash pop/apply carrying an explicit ref with no lock.
 */
export function decideLandGuard(
  command: string,
  ctx: LandGuardCtx,
): LandGuardDecision {
  const segments = commandsFor(command, 'git').map(cmd => {
    const seg = gitSegment(cmd.args)
    return { seg, stash: stashAction(seg) }
  })
  // Rule A takes precedence — scan for a blind stash pop/apply first.
  for (const { stash } of segments) {
    if (stash.action && !stash.hasExplicitRef) {
      return {
        blocked: true,
        op: `git stash ${stash.action}`,
        rule: 'stale-stash',
      }
    }
  }
  // Rule B — a destructive land op while the index lock is held.
  if (ctx.indexLockPresent) {
    for (const { seg, stash } of segments) {
      const op = landOpLabel(seg, stash)
      if (op) {
        return { blocked: true, op, rule: 'concurrent-land' }
      }
    }
  }
  return ALLOW
}

/**
 * True when the environment looks like CI, where one job runs with no rival
 * session and a hung index.lock is a crashed step to clear, not a race.
 */
export function isCiEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env['CI'] || env['GITHUB_ACTIONS'] || env['CONTINUOUS_INTEGRATION'],
  )
}

// Resolve the git directory for `repoDir`, following a worktree's `.git` FILE
// — `gitdir: <path>` — to its real gitdir so the index.lock probe is correct in
// a linked worktree, not only a primary checkout.
function gitDirFor(repoDir: string): string {
  const dotGit = path.join(repoDir, '.git')
  try {
    const st = statSync(dotGit)
    if (st.isDirectory()) {
      return dotGit
    }
    if (st.isFile()) {
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'))
      if (match) {
        return path.resolve(repoDir, match[1]!)
      }
    }
  } catch {
    // Fall through to the plain `.git` path — existsSync below returns false.
  }
  return dotGit
}

// True when another git process holds `repoDir`'s index lock. Fail toward
// "no lock" so a probe error never manufactures a concurrent-land block.
export function indexLockPresent(repoDir: string): boolean {
  try {
    return existsSync(path.join(gitDirFor(repoDir), 'index.lock'))
  } catch {
    return false
  }
}

export function formatBlock(
  decision: LandGuardDecision,
  repoDir: string,
): string {
  const op = decision.op ?? 'git'
  if (decision.rule === 'stale-stash') {
    return (
      [
        `[single-lander-guard] Blocked: blind \`${op}\` pops another session's stash. [${ERR_SINGLE_LANDER}]`,
        '',
        `  What:  \`${op}\` with no explicit <stash> ref pops stash@{0}, which in`,
        '         a shared checkout may be a DIFFERENT session’s stash, not yours.',
        `  Where: ${repoDir}`,
        `  Saw:   \`${op}\` with no stash@{N} and no other explicit <stash> arg.`,
        '  Fix:   capture your OWN ref from `git stash push` — read the printed',
        '         `stash@{N}`, or `ref=$(git stash create) && git stash store $ref`',
        '         — then pop THAT explicit ref: `git stash pop stash@{N}`. Never',
        '         blind-pop stash@{0}.',
      ].join('\n') + '\n'
    )
  }
  return (
    [
      `[single-lander-guard] Blocked: \`${op}\` while another git process holds the index lock. [${ERR_SINGLE_LANDER}]`,
      '',
      `  What:  a destructive land op — \`${op}\` — ran while another git process`,
      '         holds this repo’s index.lock, so it is mid-operation.',
      `  Where: ${repoDir} — .git/index.lock present.`,
      `  Saw:   \`${op}\` with .git/index.lock present.`,
      '  Fix:   one lander per repo. Wait for the other op to finish / let the',
      '         single armed lander complete, then retry. Never pile a destructive',
      '         git op onto a repo with an active git process.',
    ].join('\n') + '\n'
  )
}

export const check = bashGuard(command => {
  // CI runs one job with no rival session — no live-tree race to prevent.
  if (isCiEnv(process.env)) {
    return undefined
  }
  const repoDir = extractGitCwd(command)
  const decision = decideLandGuard(command, {
    indexLockPresent: indexLockPresent(repoDir),
  })
  if (!decision.blocked) {
    return undefined
  }
  return block(formatBlock(decision, repoDir))
})

export const hook = defineHook({
  bypass: ['single-lander'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
