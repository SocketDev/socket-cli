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

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isFleetRepo, slugFromRemoteUrl } from '../_shared/fleet-repos.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { withBashGuard } from '../_shared/payload.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow non-fleet-push bypass'

export function originSlug(dir: string): string | undefined {
  let out: string
  try {
    const r = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    })
    if (r.status !== 0) {
      return undefined
    }
    out = String(r.stdout ?? '').trim()
  } catch {
    return undefined
  }
  return slugFromRemoteUrl(out)
}

// withBashGuard handles the stdin drain, tool_name gate, command narrow,
// and fail-open on any throw.
await withBashGuard((command, payload) => {
  // Detect `git push` via the shell parser (not regex): it splits the
  // command line into segments, sees through `&&`/`|`/`;` chains and
  // `$(…)` substitution, and ignores `push` inside a quoted commit
  // message — so `git commit -m "git push later"` is correctly NOT a
  // push, while `cd /x && git push` and `git -C /x push` are.
  if (!findInvocation(command, { binary: 'git', subcommand: 'push' })) {
    return
  }

  const dir = extractGitCwd(command)
  const slug = originSlug(dir)

  // Fail open: no resolvable origin slug → can't classify, allow.
  if (!slug) {
    return
  }
  if (isFleetRepo(slug)) {
    return
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return
  }

  logger.error(
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
      `  you own), type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
