#!/usr/bin/env node
// Claude Code PreToolUse hook — non-fleet-pr-issue-ask-guard.
//
// Blocks `gh pr create` / `gh issue create` / `gh release create`
// calls that target a repository NOT in the fleet roster. The
// canonical fleet rule: never auto-submit publicly-visible artifacts
// (PRs, issues, releases) to upstream / third-party repos without
// explicit user confirmation. Captured plan text + batched "do all N
// tasks" directives are NOT standing authorization to post under the
// user's gh identity.
//
// 2026-05-28 incident: a captured-plan task said "file an oxfmt
// upstream issue" as one bullet. Working through the deferred list,
// I ran `gh issue create --repo oxc-project/oxc ...` without re-
// confirming. The user said "don't create an issue" but the bg `gh`
// call had already completed; the issue was live until closed
// post-hoc with an "opened in error" comment. This hook prevents
// the repeat.
//
// Detection:
//   - Fires only on Bash commands containing `gh pr create`,
//     `gh issue create`, or `gh release create`.
//   - Resolves the target repo via `--repo <owner>/<name>` flag
//     when present, otherwise via `git remote get-url origin` from
//     the resolved git cwd (same priority order as
//     `no-non-fleet-push-guard`: -C <dir>, then `cd <dir> &&`,
//     then process.cwd()).
//   - Blocks when the slug is not in FLEET_REPO_NAMES.
//
// Bypass: `Allow non-fleet-publish bypass` typed verbatim in a
// recent user turn.
//
// Fails OPEN on resolution ambiguity (can't find the command, the
// dir, or the remote): better to under-block than to wedge a
// legitimate fleet PR/issue when the shape is unfamiliar.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import {
  acceptedScopedBypassPhrases,
  isFleetRepo,
  originSlug,
} from '../_shared/fleet-repos.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { commandsFor, flagValue } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

import type { Command } from '../_shared/shell-command.mts'

// Bare, session-wide form (kept as a fallback). The scoped form is
// preferred — it names the exact repo so authorization can't leak to an
// unrelated non-fleet publish later in the session.
const BYPASS_PHRASE = 'Allow non-fleet-publish bypass'
const BYPASS_PHRASE_PREFIX = 'Allow non-fleet-publish bypass:'

// Phrases that authorize a publish to this repo: the bare session-wide
// fallback plus a scoped phrase for every identifier the operator might type
// (case-preserved `owner/repo`, bare repo name) — GitHub slugs are
// case-insensitive, so `PerryTS/perry` and `perryts/perry` both
// authorize (#45).
export function acceptedBypassPhrases(
  targets: ReadonlyArray<string | undefined>,
): string[] {
  return acceptedScopedBypassPhrases(BYPASS_PHRASE, targets)
}

// gh subcommands that publish public-facing content. `release create`
// is also in the harness deny list, but the hook layer here catches
// the bypass-phrase escape path so the user has ONE consistent way
// to authorize public-facing actions.
const PUBLIC_SURFACE_SUBCOMMANDS = [
  ['pr', 'create'],
  ['issue', 'create'],
  ['release', 'create'],
] as const

// True when a parsed `gh` segment is one of the publishing subcommands.
export function isPublicGhCmd(c: Command): boolean {
  return PUBLIC_SURFACE_SUBCOMMANDS.some(
    pair => c.args[0] === pair[0] && c.args[1] === pair[1],
  )
}

// The `--repo` / `-R` target of a publishing gh segment, read from the
// segment's PARSED args (never a regex over the raw command string, where a
// quoted "--repo x" inside a title or heredoc body would false-match).
export function extractGhTargetRepo(command: string): string | undefined {
  for (const c of commandsFor(command, 'gh')) {
    if (!isPublicGhCmd(c)) {
      continue
    }
    const value = flagValue(c.args, '--repo', '-R')
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}

// Identifies the gh subcommand. Returns the matching
// [verb, action] pair when one is present at an executable
// position, undefined otherwise.
export function findPublicGhInvocation(
  command: string,
): readonly [string, string] | undefined {
  const ghCommands = commandsFor(command, 'gh')
  for (const c of ghCommands) {
    for (const pair of PUBLIC_SURFACE_SUBCOMMANDS) {
      if (c.args[0] === pair[0] && c.args[1] === pair[1]) {
        return pair
      }
    }
  }
  return undefined
}

export const check = bashGuard((command, payload) => {
  if (!/\bgh\b/.test(command)) {
    return undefined
  }
  const subcommand = findPublicGhInvocation(command)
  if (!subcommand) {
    return undefined
  }

  // Resolve target slug. `--repo` carries owner/repo (shown
  // verbatim in messages). For membership, `isFleetRepo` keys on
  // the bare repo name, so strip the owner before checking.
  let slug: string | undefined
  const dashRepo = extractGhTargetRepo(command)
  if (dashRepo) {
    slug = dashRepo
  } else {
    const cwd = extractGitCwd(command)
    slug = originSlug(cwd)
  }
  if (!slug) {
    // Fail open — can't determine target. The user gets the gh
    // command's own error if it's malformed.
    return undefined
  }
  const slashIdx = slug.indexOf('/')
  const bareSlug = slashIdx === -1 ? slug : slug.slice(slashIdx + 1)

  if (isFleetRepo(bareSlug)) {
    // Fleet repo — fall through. The action is authorized by being
    // inside the fleet.
    return undefined
  }

  // Non-fleet target. Check bypass phrase.
  if (
    payload.transcript_path &&
    bypassPhrasePresent(
      payload.transcript_path,
      acceptedBypassPhrases([slug, bareSlug]),
    )
  ) {
    return undefined
  }

  return block(
    [
      'non-fleet-pr-issue-ask-guard: blocked',
      '',
      `  Command targets non-fleet repo: ${slug}`,
      `  Subcommand: gh ${subcommand.join(' ')}`,
      '',
      `  Public-facing artifacts (PRs, issues, releases) on non-fleet`,
      `  repos go out under your gh identity. The fleet rule: never`,
      `  submit without explicit per-action user confirmation —`,
      `  captured plans + "do all N tasks" directives do NOT count.`,
      '',
      `  If you really want to submit: type the scoped phrase for THIS`,
      `  repo in your next message, then re-run:`,
      `    ${BYPASS_PHRASE_PREFIX} ${slug}`,
      '',
      `  The scoped form authorizes ${slug} only — it can't leak to an`,
      `  unrelated non-fleet publish later. (The bare, session-wide`,
      `  "${BYPASS_PHRASE}" is still accepted as a fallback.)`,
      '',
      '  Otherwise: draft locally, share for review, get explicit',
      '  yes/no before re-attempting.',
    ].join('\n') + '\n',
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
