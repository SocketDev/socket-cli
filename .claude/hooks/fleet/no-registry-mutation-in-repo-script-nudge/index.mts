#!/usr/bin/env node
// Claude Code PreToolUse hook — no-registry-mutation-in-repo-script-nudge.
//
// @file A committed `scripts/repo/**` script must not embed a direct registry
//   mutation — `publish`, `deprecate`, or `unpublish` (via npm / pnpm / yarn).
//   Such a script is either a one-time bootstrap, which belongs in scratch
//   (`os.tmpdir()`), run once and discarded — or a recurring release, which
//   belongs in the OIDC publish workflow (`npm-publish.yml` →
//   `scripts/fleet/npm-publish.mts`), never a hand-committed repo script.
//   `scripts/repo/` is for tooling that runs more than once.
//
// Detection (Write/Edit/MultiEdit to a `scripts/repo/**` script): a quoted
//   package-manager token (`'npm'` / `'pnpm'` / `'yarn'`) AND a quoted mutation
//   verb (`'publish'` / `'deprecate'` / `'unpublish'`) — i.e. a spawned
//   registry mutation. Best-effort: args built from a variable escape it.
//   Read-only calls (`view`, `whoami`) never match. The sanctioned publisher
//   lives under `scripts/fleet/`, which this hook never scans.
//
// Bypass: no phrase — a nudge never blocks, always exits 0.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

const SCRIPT_EXT_RE = /\.(?:cjs|cts|js|mjs|mts|sh|ts)$/

// A quoted package-manager token — e.g. the first arg of a spawn call.
const PM_TOKEN_RE = /(['"])(?:npm|pnpm|yarn)\1/

// A quoted registry-mutation verb — e.g. an element of an args array.
const VERB_RE = /(['"])(?:deprecate|publish|unpublish)\1/

/**
 * True when the about-to-land content embeds a spawned registry mutation. Pure
 * — no I/O.
 */
export function hasRegistryMutation(content: string): boolean {
  return PM_TOKEN_RE.test(content) && VERB_RE.test(content)
}

/**
 * True when `filePath` (any separator) is a script file under `scripts/repo/`.
 */
export function isRepoScript(filePath: string): boolean {
  const unix = normalizePath(filePath)
  if (!unix.includes('/scripts/repo/') && !unix.startsWith('scripts/repo/')) {
    return false
  }
  return SCRIPT_EXT_RE.test(unix)
}

export function buildMessage(): string {
  return [
    '🚨 no-registry-mutation-in-repo-script-nudge: a committed scripts/repo/',
    '   script embeds a direct registry mutation (publish / deprecate /',
    '   unpublish).',
    '',
    'One-off registry ops belong in scratch (os.tmpdir()) — run once, discard —',
    'not committed repo tooling; a recurring release goes through the OIDC',
    'workflow (npm-publish.yml → scripts/fleet/npm-publish.mts). scripts/repo/',
    'is for tooling that runs more than once. (CLAUDE.md → plan-storage.)',
  ].join('\n')
}

export const check = editGuard((filePath, content) => {
  if (content === undefined || !isRepoScript(filePath)) {
    return undefined
  }
  if (!hasRegistryMutation(content)) {
    return undefined
  }
  return notify(buildMessage())
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Write', 'Edit', 'MultiEdit'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
