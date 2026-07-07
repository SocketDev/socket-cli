#!/usr/bin/env node
// Claude Code PreToolUse hook — node-modules-staging-guard.
//
// Blocks `git add -f` / `git add --force` invocations targeting paths
// that contain `/node_modules/` or that point at a `package-lock.json`
// under `.claude/hooks/*/` or `.claude/skills/*/`. Past incident: a
// cascading agent used `git add -f` to commit `.claude/hooks/check-new-
// deps/node_modules/` into 6 fleet repos. Removing it required force-
// push (which is itself a hazard) or filter-branch/filter-repo.
//
// The `-f` (force) flag exists for the rare case where a gitignored
// file legitimately needs to be staged. It should never be used for
// node_modules or hook/skill package-lock.json files — those are
// gitignored intentionally because each consumer runs its own install.
//
// Detection: parse the Bash command, look for `git add -f` (or
// `--force`), then check every path argument. If any path contains
// `node_modules/` (anywhere in the path) OR points at a
// `package-lock.json` under `.claude/hooks/<name>/` /
// `.claude/skills/<name>/`, block.
//
// Bypass: `Allow node-modules-staging bypass` typed verbatim in a recent
// user turn. Use sparingly — legitimate force-stages of node_modules
// are vanishingly rare.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow node-modules-staging bypass'

// Dispatcher pre-flight: a block requires a forbidden PATH arg, and every
// forbidden path (per `isForbiddenPath`) contains one of these substrings —
// a `node_modules` segment, or a hook/skill `package-lock.json` /
// `pnpm-lock.yaml`. A command lacking all three can never block, so the
// dispatcher skips importing this guard for it.
export const triggers: readonly string[] = [
  'node_modules',
  'package-lock.json',
  'pnpm-lock.yaml',
]

// Tokenize the command on whitespace; split on `&&`/`||`/`;`/`|` so we
// don't merge chained commands. The git invocation may be wrapped by
// env-var assignments (`FOO=bar git add ...`).
export function findGitAddForceInvocations(command: string): string[][] {
  const out: string[][] = []
  const segments = command.split(/(?:&&|\|\||;|\n)/)
  for (let i = 0, { length } = segments; i < length; i += 1) {
    const segment = segments[i]!
    const tokens = segment.trim().split(/\s+/)
    // `j` for the inner cursor — outer loop already owns `i`.
    let j = 0
    while (j < tokens.length && tokens[j]!.includes('=')) {
      j += 1
    }
    if (tokens[j] !== 'git') {
      continue
    }
    if (tokens[j + 1] !== 'add') {
      continue
    }
    const rest = tokens.slice(j + 2)
    const hasForce = rest.some(arg => arg === '--force' || arg === '-f')
    if (!hasForce) {
      continue
    }
    out.push(rest)
  }
  return out
}

export function isForbiddenPath(arg: string): boolean {
  // `-f` / `--force` are flag-only, not paths.
  if (arg.startsWith('-')) {
    return false
  }
  // Strip quotes.
  const stripped = arg.replace(/^["']|["']$/g, '')
  // Any `/node_modules/` segment OR a top-level `node_modules` /
  // `node_modules/...`.
  if (
    /(?:^|\/)node_modules(?:\/|$)/.test(stripped) ||
    /[\\]node_modules(?:[\\]|$)/.test(stripped)
  ) {
    return true
  }
  // `package-lock.json` under `.claude/hooks/<name>/` or
  // `.claude/skills/<name>/`.
  if (
    /(?:^|\/)\.claude\/(?:hooks|skills)\/[^/]+\/(?:package-lock\.json|pnpm-lock\.yaml)$/.test(
      stripped,
    )
  ) {
    return true
  }
  return false
}

export const check = bashGuard((command, payload) => {
  const forced = findGitAddForceInvocations(command)
  if (forced.length === 0) {
    return undefined
  }

  const blockedArgs: string[] = []
  for (let i = 0, { length } = forced; i < length; i += 1) {
    const restArgs = forced[i]!
    for (let i = 0, { length } = restArgs; i < length; i += 1) {
      const arg = restArgs[i]!
      if (isForbiddenPath(arg)) {
        blockedArgs.push(arg)
      }
    }
  }
  if (blockedArgs.length === 0) {
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  return block(
    [
      '[node-modules-staging-guard] Blocked: `git add -f` of node_modules / hook lockfile',
      '',
      '  Forbidden paths in the command:',
      ...blockedArgs.map(a => `    ${a}`),
      '',
      '  Past incident: a cascading agent committed',
      '  `.claude/hooks/fleet/check-new-deps/node_modules/` into 6 fleet repos.',
      '  Removing it required force-push (itself a hazard) or filter-branch.',
      '',
      '  `node_modules/` and hook `package-lock.json` files are gitignored',
      '  INTENTIONALLY. Each consumer runs its own `pnpm install` against',
      '  the package.json that did land in the commit.',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
