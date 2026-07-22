#!/usr/bin/env node
// Claude Code PreToolUse hook — push-protected-branch-guard.
//
// Blocks a `git push` that would UPDATE a protected remote branch
// (`main` / `master`) unless the user explicitly authorized a push.
//
// Why this exists: "land", "commit", "surgically commit" all mean a
// LOCAL commit. They do NOT mean push. A real incident had an agent
// `git push` to a shared repo's `origin/main` when the user only asked
// to commit locally — irreversible on a shared trunk, and the exact
// mistake this guard prevents. A sub-agent CANNOT self-authorize: the
// only thing that lifts the block is an explicit "push" / "Allow push
// to main" instruction in a genuine USER turn (its own transcript is
// its own — a sub-agent reading its prompt back can't fake a user
// directive, because the bypass scanner reads only user-role text).
//
// What it DENIES (a write to a protected branch):
//   - git push origin main
//   - git push origin HEAD:main
//   - git push origin <sha>:refs/heads/main
//   - git push --force / --force-with-lease … main|master
//   - git push origin :main          (deleting a protected branch)
//   - a BARE `git push` on a checkout whose current branch is
//     main|master (it targets the upstream main|master)
//
// What it ALLOWS (must NOT over-block — the PR / feature-branch flow):
//   - git push fork perf/foo
//   - git push origin feature-x
//   - git push -u fork branch:branch
//   - git push origin v1.0  /  git push origin tag v1.0  (a tag)
//   - git commit / git fetch / any non-push git command
//
// Detection: the push is found via the fleet shell parser (sees through
// `&&`/`|` chains, `$(…)` substitution, and ignores a `push` token
// inside a quoted commit message), and the DESTINATION ref of every
// refspec is parsed (`HEAD:refs/heads/main` → `main`) by
// `_shared/push-refspec.mts`. A bare / `HEAD` push resolves the repo's
// current branch.
//
// Bypass: an explicit user-turn "push" directive — the canonical phrase
// `Allow push to main` (also `Allow push-to-protected bypass`), typed
// verbatim in a recent USER message. One authorization, the user's own.
//
// Fails OPEN on any parse / resolution ambiguity: the cost of a missed
// block is one push the operator can force-revert with a warning; the
// cost of a false block is a wedged feature-branch workflow.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { currentBranch } from '../_shared/git-branch.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { findProtectedBranchPush } from '../_shared/push-refspec.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { squashSentinelAllows } from '../_shared/squash-sentinel.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Pre-flight trigger: the dispatcher skips importing this guard unless the raw
// payload contains `push`. A protected-branch push can only be detected when a
// `git push` is present, and `findInvocation(..., { subcommand: 'push' })`
// requires the literal `push` token — so it is a necessary substring.
export const triggers: readonly string[] = ['push']

// The canonical authorization phrases. `Allow push to main` is the spelling the
// deny message tells the user to type; the `bypass`-suffixed form matches the
// fleet's `Allow <X> bypass` convention. Both are normalized (case / dash /
// whitespace folded) by the transcript scanner, so `allow push to master`,
// `Allow push-to-protected bypass`, etc. all count.
const BYPASS_PHRASES = [
  'Allow push to main',
  'Allow push to master',
  'Allow push-to-protected bypass',
  'Allow protected-push bypass',
] as const

export const check = bashGuard((command, payload) => {
  // Cheap gate: is there a `git push` at an executable position at all? Sees
  // through chains / substitution; ignores `push` inside a quoted message.
  if (!findInvocation(command, { binary: 'git', subcommand: 'push' })) {
    return undefined
  }

  const gitCwd = extractGitCwd(command, { subcommand: 'push' })
  const offending = findProtectedBranchPush(command, gitCwd, currentBranch)
  if (!offending) {
    return undefined
  }

  // The squashing-history skill's own force-push (SQUASH_HISTORY=1 sentinel,
  // hardened single-segment `git push … HEAD:<base>` shape) is the ONE
  // self-authorized protected push — the skill runs only after the user
  // invoked it, and the sentinel check rejects every weaponized variant.
  if (squashSentinelAllows(command)) {
    return undefined
  }

  // A protected-branch push. Allow ONLY if the user explicitly authorized it.
  // The plain protected-push phrases are LOW-RISK — GitHub branch protection is
  // the real final gate behind a fast-forward push to the shared trunk — so
  // their trailing `bypass` keyword is OPTIONAL (`Allow push to main` counts).
  // The branch-scoped combo `Allow force-with-lease <branch> bypass` stays
  // STRICT: it also satisfies no-force-push-guard for a squash-repo lease-force
  // reconcile, where the remote ACCEPTS the force push (branch protection is not
  // the backstop there), so it must be typed in full and scoped to this branch.
  if (
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES, undefined, {
      optionalSuffix: true,
    }) ||
    bypassPhrasePresent(
      payload.transcript_path,
      `Allow force-with-lease ${offending.branch} bypass`,
    )
  ) {
    return undefined
  }

  const remoteLabel = offending.remote ?? 'the remote'
  const target = `${remoteLabel}:${offending.branch}`
  return block(
    [
      `[push-protected-branch-guard] Refusing to push to ${target} — ` +
        `"land"/"commit" means a LOCAL commit.`,
      '',
      `  This would update the protected branch \`${offending.branch}\` on a`,
      '  shared remote. Pushing to a shared trunk is irreversible and is NOT',
      '  what "land", "commit", or "surgically commit" ask for — those mean a',
      '  local commit only.',
      '',
      '  If you only need to commit, do it locally and stop:',
      '    git commit -m "<conventional message>"',
      '',
      '  If a push to the protected branch is genuinely intended, it must be',
      '  authorized by the USER (a sub-agent cannot authorize itself). Re-run',
      '  with an explicit "push" instruction from the user — type the phrase',
      '  verbatim in a new message, then retry:',
      `    Allow push to ${offending.branch}`,
      '',
      '  For a lease-force push (squash-repo reconcile), ONE phrase covers',
      '  both this guard and no-force-push-guard, scoped to this branch:',
      `    Allow force-with-lease ${offending.branch} bypass`,
      '',
      '  To open a PR instead (the normal flow), push a FEATURE branch — that',
      '  is always allowed:',
      '    git push -u origin <feature-branch>',
      '',
    ].join('\n') + '\n',
  )
})

export const hook = defineHook({
  bypass: ['push-to-protected', 'protected-push', 'force-with-lease'],
  bypassMode: 'manual',
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})

void runHook(hook, import.meta.url)
