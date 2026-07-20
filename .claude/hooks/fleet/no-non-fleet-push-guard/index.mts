#!/usr/bin/env node
// Claude Code PreToolUse hook — no-non-fleet-push-guard.
//
// Blocks `git push` to a repository that is NOT a fleet member. The
// fleet's git-side pre-push hook can't catch this: a non-fleet repo
// never has the fleet hook chain installed (that's exactly how a stray
// push to e.g. `depot` slips through). So the guard lives agent-side,
// inspecting the Bash command before it runs, and resolves the target
// repo's origin remote against the canonical fleet roster.
//
// Detection model:
//   - Fires only on Bash commands containing `git push` at an
//     executable position (not inside quotes / heredoc bodies — a
//     commit message that says "git push" is not a push).
//   - Resolves the TARGET directory, in priority order:
//       1. `git -C <dir> push …`        (explicit -C)
//       2. a leading `cd <dir> && …`     (the `cd /…/depot && git push`
//          shape that bypasses the session cwd)
//       3. the hook's process cwd
//   - Reads `git -C <dir> remote get-url origin`, extracts the repo
//     slug, and blocks when the slug is not in FLEET_REPO_NAMES.
//
// Bypass: `Allow non-fleet-push bypass` typed verbatim in a recent user
// turn — for the rare legitimate push to a personal / non-fleet repo.
//
// Fails OPEN on any resolution ambiguity (can't find the command, the
// dir, or the remote): better to under-block than to wedge a valid
// push when the shape is unfamiliar. The cost of a missed block is one
// `Allow … bypass`-free push the operator can revert; the cost of a
// false block is a bricked workflow.

import path from 'node:path'

import {
  acceptedScopedBypassPhrases,
  isFleetRepo,
  originOwnerRepo,
  originSlug,
} from '../_shared/fleet-repos.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Bare, session-wide form (kept as a fallback). The scoped form below
// is preferred — it names the exact repo so the authorization can't
// leak to an unrelated non-fleet push later in the session.
const BYPASS_PHRASE = 'Allow non-fleet-push bypass'
const BYPASS_PHRASE_PREFIX = 'Allow non-fleet-push bypass:'

// The origin-remote readers are the shared fleet-repos ones; re-exported so
// this guard's tests exercise the exact resolvers the check runs.
export { originOwnerRepo, originSlug }

// Build the phrases that authorize a push to this repo. Accept every
// identifier the user might reasonably type — the case-preserved `owner/repo`
// (`PerryTS/perry`), the bare repo name (`perry`), and the local checkout dir
// basename. So `Allow non-fleet-push bypass: perry` and
// `… bypass: PerryTS/perry` both authorize the same push.
export function acceptedBypassPhrases(
  targets: ReadonlyArray<string | undefined>,
): string[] {
  return acceptedScopedBypassPhrases(BYPASS_PHRASE, targets)
}

export const check = bashGuard((command, payload) => {
  // Detect `git push` via the shell parser (not regex): it splits the
  // command line into segments, sees through `&&`/`|`/`;` chains and
  // `$(…)` substitution, and ignores `push` inside a quoted commit
  // message — so `git commit -m "git push later"` is correctly NOT a
  // push, while `cd /x && git push` and `git -C /x push` are.
  if (!findInvocation(command, { binary: 'git', subcommand: 'push' })) {
    return undefined
  }

  const dir = extractGitCwd(command, { subcommand: 'push' })
  const slug = originSlug(dir)

  // Fail open: no resolvable origin slug → can't classify, allow.
  if (!slug) {
    return undefined
  }
  if (isFleetRepo(slug)) {
    return undefined
  }

  // Accept a scoped bypass naming the repo by any identifier the operator
  // sees: bare slug, case-preserved owner/repo, or the local dir basename.
  const targets = [slug, originOwnerRepo(dir), path.basename(dir)]
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, acceptedBypassPhrases(targets))
  ) {
    return undefined
  }

  return block(
    [
      '[no-non-fleet-push-guard] Blocked: push to a non-fleet repository',
      '',
      `  Target dir:  ${dir}`,
      `  origin repo: ${slug}`,
      '',
      `  \`${slug}\` is not in the fleet roster, and fleet tooling must`,
      '  not push to repos outside the fleet. A non-fleet repo has no',
      '  fleet hook chain, so this agent-side guard is the only check',
      '  standing between you and a stray push to someone else’s repo.',
      '',
      '  If this push is wrong: you probably `cd`-ed into the wrong repo',
      '  or have the wrong `origin`. Verify with:',
      `    git -C ${dir} remote get-url origin`,
      '',
      `  If the push is genuinely intended (a personal / non-fleet repo`,
      `  you own), type the scoped phrase for THIS repo in a new message,`,
      '  then retry:',
      `    ${BYPASS_PHRASE_PREFIX} ${slug}`,
      '',
      `  The scoped form authorizes ${slug} only — it can’t leak to an`,
      '  unrelated non-fleet push later. (The bare, session-wide',
      `  "${BYPASS_PHRASE}" is still accepted as a fallback.)`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['non-fleet-push'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
