#!/usr/bin/env node
// Claude Code PreToolUse hook — no-fleet-scope-in-non-member-guard.
//
// Blocks `git commit` when the subject carries the conventional scope
// `fleet` — `chore(fleet): …`, `fix(fleet)!: …` — and the target repo's
// origin remote is NOT in the fleet roster. The incident this codifies:
// a fleet sweep treated a non-member clone under ~/projects as fleet
// surface and landed a fleet-convention commit there. A fleet-scoped
// subject asserts "this is fleet work", so a non-member origin means
// the tooling is aimed at the wrong repo — the commit-message shape is
// the clean, deterministic signal (the commit-message-format-guard
// precedent).
//
// Scoped, not absolute: only the exact scope `fleet` fires; any other
// scope, an unscoped subject, or a non-conventional subject is out of
// scope. Fails OPEN when the origin remote is unresolvable — an
// unclassifiable repo must not wedge unrelated commits.
//
// Detection model mirrors no-non-fleet-push-guard: resolve the TARGET
// directory (`git -C <dir>`, a leading `cd <dir> && …`, else the hook's
// cwd), read its origin remote, and block when the slug is outside the
// roster (.claude/skills/fleet/cascading-fleet/lib/fleet-repos.json).
//
// Bypass: `Allow fleet-scope-commit bypass` — the scoped form
// `Allow fleet-scope-commit bypass: <repo>` is preferred; it authorizes
// exactly one repo.

import path from 'node:path'

import {
  extractCommitMessage,
  isGitCommit,
} from '../_shared/commit-command.mts'
import {
  acceptedScopedBypassPhrases,
  isFleetRepo,
  originOwnerRepo,
  originSlug,
} from '../_shared/fleet-repos.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Pre-flight triggers: the guard can only block a `git commit`, and that
// detection requires the literal `commit` token — safe to gate on.
export const triggers: readonly string[] = ['commit']

const BYPASS_PHRASE = 'Allow fleet-scope-commit bypass'
const BYPASS_PHRASE_PREFIX = 'Allow fleet-scope-commit bypass:'

// Conventional subject whose scope is exactly `fleet`:
// `<type>(fleet): …` or `<type>(fleet)!: …`.
const FLEET_SCOPE_RE = /^[a-z]+\(fleet\)!?:/

/**
 * True when the commit subject's conventional scope is exactly `fleet`.
 * Pure; exported for tests.
 */
export function hasFleetScope(subject: string): boolean {
  return FLEET_SCOPE_RE.test(subject)
}

export const check = bashGuard((command, payload) => {
  if (!isGitCommit(command)) {
    return undefined
  }
  const message = extractCommitMessage(command)
  if (!message) {
    return undefined
  }
  const subject = message.split('\n', 1)[0] ?? ''
  if (!hasFleetScope(subject)) {
    return undefined
  }

  const dir = extractGitCwd(command, { subcommand: 'commit' })
  const slug = originSlug(dir)
  // Fail open: no resolvable origin slug → can't classify, allow.
  if (!slug) {
    return undefined
  }
  if (isFleetRepo(slug)) {
    return undefined
  }

  const targets = [slug, originOwnerRepo(dir), path.basename(dir)]
  if (
    payload.transcript_path &&
    bypassPhrasePresent(
      payload.transcript_path,
      acceptedScopedBypassPhrases(BYPASS_PHRASE, targets),
    )
  ) {
    return undefined
  }

  return block(
    [
      '[no-fleet-scope-in-non-member-guard] Blocked: fleet-scoped commit in a non-member repository',
      '',
      `  Target dir:  ${dir}`,
      `  origin repo: ${slug}`,
      `  subject:     ${subject}`,
      '',
      `  The subject's \`(fleet)\` scope says this is fleet work, but`,
      `  \`${slug}\` is not in the fleet roster`,
      '  — .claude/skills/fleet/cascading-fleet/lib/fleet-repos.json.',
      '  A clone under ~/projects is not fleet surface by location; fleet',
      '  tooling must confirm roster membership before writing into a repo.',
      '',
      '  If this commit is wrong: you are in the wrong repo — verify with:',
      `    git -C ${dir} remote get-url origin`,
      '',
      '  If the commit is genuinely intended, type the scoped phrase for',
      '  THIS repo in a new message, then retry:',
      `    ${BYPASS_PHRASE_PREFIX} ${slug}`,
      '',
      `  The scoped form authorizes ${slug} only. The bare, session-wide`,
      `  "${BYPASS_PHRASE}" is still accepted as a fallback.`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['fleet-scope-commit'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  global: true,
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
