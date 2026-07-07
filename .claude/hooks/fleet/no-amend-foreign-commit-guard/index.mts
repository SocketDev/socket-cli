#!/usr/bin/env node
// Claude Code PreToolUse hook — no-amend-foreign-commit-guard.
//
// Blocks `git commit --amend` when HEAD is an UNPUSHED commit that this session
// almost certainly did NOT author — i.e. a parallel Claude session's in-flight
// work sitting on the shared checkout's branch. Amending it rewrites someone
// else's commit (folding your change + message into their feature commit), and
// because it's unpushed there's no remote copy to recover from.
//
// The safe, common case — amending the commit you JUST made — is allowed: a
// freshly-authored tip has a commit time within minutes of now. The dangerous
// case — amending a commit that has been sitting unpushed for a while (another
// session made it) — is blocked. Two conditions must BOTH hold to block:
//   1. HEAD is ahead of the remote default branch (origin/<default>..HEAD ≥ 1),
//      so the amend rewrites local-only history; AND
//   2. HEAD's commit timestamp is older than a freshly-made-tip threshold
//      (it isn't a commit you just created this turn).
//
// Detection reads git state from the target repo (extractGitCwd); the
// block/allow decision is the pure `shouldBlockAmend`, which the test drives.
//
// Why: a session amended a parallel session's unpushed feature commit while
// trying to quickly land an unrelated change — it swept the change into the
// wrong commit and rewrote its message. A `git status` HEAD-check before
// amending would have caught it; this enforces that check.
//
// Bypass: `Allow amend-foreign bypass` (the rare intentional amend of an older
// own-commit). Exit 0 allow / 2 block. Fails open on any internal error.

// oxlint-disable-next-line socket/prefer-async-spawn -- PreToolUse hook needs a sync git read to gate the command before it runs; typed string return.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { resolveDefaultBranch } from '../_shared/git-branch.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow amend-foreign bypass'

// Pre-flight skip set. The only path to a block is gated by `isAmendCommit`,
// which requires a `git` segment whose args include both `commit` and
// `--amend`; `--amend` is therefore present verbatim in EVERY blocking command.
// The dispatcher skips importing this guard when the payload lacks it.
export const triggers: readonly string[] = ['--amend']

// A commit younger than this is treated as "freshly authored this turn" — safe
// to amend. Older + unpushed → likely a parallel session's commit.
const FRESH_TIP_MS = 10 * 60 * 1000

// Read-only snapshot of the git state the amend decision needs.
export interface AmendHeadInfo {
  // HEAD commits ahead of the remote default branch (origin/<default>..HEAD).
  aheadOfRemote: number
  // HEAD committer timestamp in epoch ms, or undefined when unreadable.
  headCommitMs: number | undefined
}

// Is this command a `git commit --amend`? (any git segment carrying both).
export function isAmendCommit(command: string): boolean {
  for (const c of commandsFor(command, 'git')) {
    if (c.args.includes('commit') && c.args.includes('--amend')) {
      return true
    }
  }
  return false
}

// The pure block decision. Blocks only when the amend rewrites an unpushed,
// not-freshly-made tip (a parallel session's commit). `nowMs` is injected so
// the test is deterministic. Returns a reason when blocking, else undefined.
export function shouldBlockAmend(
  info: AmendHeadInfo,
  nowMs: number,
): string | undefined {
  if (info.aheadOfRemote < 1) {
    // HEAD matches the remote tip — amending re-authors a pushed commit, a
    // force-push concern handled elsewhere, not a foreign-commit one.
    return undefined
  }
  if (info.headCommitMs === undefined) {
    return undefined
  }
  const ageMs = nowMs - info.headCommitMs
  if (ageMs <= FRESH_TIP_MS) {
    // Freshly authored this turn — the safe, common amend.
    return undefined
  }
  const ageMin = Math.round(ageMs / 60_000)
  return `HEAD is an unpushed commit from ~${ageMin} min ago (not one you made this turn) — amending it rewrites a parallel session's work`
}

// Read the git state for the decision from `repoDir`. Sync so the PreToolUse
// hook can decide before the command runs.
export function readAmendHeadInfo(repoDir: string): AmendHeadInfo {
  const run = (args: readonly string[]): string => {
    const r = spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
    /* c8 ignore next - spawnSync with encoding:'utf8' always returns a string; ?? '' is a structural guard */
    return String(r.stdout ?? '').trim()
  }
  const base = resolveDefaultBranch(repoDir)
  const aheadOfRemote = Number(
    run(['rev-list', '--count', `origin/${base}..HEAD`]),
  )
  const tsSec = Number(run(['log', '-1', '--format=%ct', 'HEAD']))
  return {
    /* c8 ignore start - git --count and %ct always output digits or empty string (→ 0); non-integer fallbacks are structural guards */
    aheadOfRemote: Number.isInteger(aheadOfRemote) ? aheadOfRemote : 0,
    headCommitMs: Number.isInteger(tsSec) ? tsSec * 1000 : undefined,
    /* c8 ignore stop */
  }
}

export const check = bashGuard(
  (command: string, payload: ToolCallPayload): GuardResult => {
    if (!isAmendCommit(command)) {
      return undefined
    }
    const repoDir = extractGitCwd(command, { subcommand: 'commit' })
    const reason = shouldBlockAmend(readAmendHeadInfo(repoDir), Date.now())
    if (!reason) {
      return undefined
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return undefined
    }
    return block(
      [
        '[no-amend-foreign-commit-guard] Blocked: `git commit --amend` onto a foreign unpushed commit.',
        '',
        `  Repo:  ${repoDir}`,
        `  ${reason}.`,
        '',
        '  Amending an unpushed commit you did not author this turn folds your',
        "  change into a parallel session's commit (and rewrites its message),",
        '  with no remote copy to recover from.',
        '',
        '  Fix: verify HEAD first — `git log -1 --format=%s` +',
        '  `git rev-list --count origin/<default>..HEAD`. If the tip is another',
        "  session's, commit your change as a NEW commit, not an amend.",
        '',
        `  If you truly mean to amend this older own-commit, type: ${BYPASS_PHRASE}`,
      ].join('\n'),
    )
  },
)

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
