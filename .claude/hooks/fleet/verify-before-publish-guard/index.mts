#!/usr/bin/env node
// Claude Code PreToolUse hook — verify-before-publish-guard.
//
// BLOCKS two publish-family footguns, in EVERY repo (fleet or external —
// registry mistakes are universal guardrails, same posture as
// no-direct-linter-guard):
//
// 1. Git-spec misparse: `npm|pnpm|yarn publish <arg>` where the path arg
//    contains `/` without a leading `./`, `../`, `/`, or `~`. npm resolves a
//    bare `a/b` as the GitHub repository `a/b`, not a local folder — the
//    publish dies on `git ls-remote`. Also fires when the publish command is
//    EMBEDDED in a generated snippet (`printf 'npm publish placeholders/x' |
//    pbcopy`): handing the user broken commands is the same defect as running
//    them.
//
// 2. Unverified publish: a non-`--dry-run` publish with no same-session
//    registry-read receipt — no `npm view` / `npm info` / `gh release view` in
//    a recent assistant tool call. Publishing is irreversible (a version can
//    never be republished); reading the current published state first is
//    mandatory. Run the read, then retry — the receipt makes the same command
//    pass.
//
// Detection is AST-based (`parseCommands` on the fleet shell parser) for real
// invocations; snippet-embedded publishes are found by whitespace-token
// scanning of string arguments — no command-matching regexes.
//
// Bypass: `Allow verify-before-publish bypass` typed verbatim in a recent user
// turn.
//
// Fails open on parse / payload errors — a guard bug must not wedge every Bash
// call.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor, parseCommands } from '../_shared/shell-command.mts'
import {
  bypassPhrasePresent,
  readLastAssistantToolUses,
  readPriorAssistantToolUses,
} from '../_shared/transcript.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const BYPASS_PHRASE = 'Allow verify-before-publish bypass' as const

const PUBLISH_BINARIES = ['npm', 'pnpm', 'yarn'] as const

// How many prior assistant turns to scan for a registry-read receipt.
const RECEIPT_LOOKBACK_TURNS = 5

export const triggers: readonly string[] = ['publish']

export interface PublishHit {
  readonly dryRun: boolean
  readonly misparsedArg: string | undefined
  readonly source: string
}

/**
 * Classify a publish target: a token containing `/` without a path prefix is
 * what npm resolves as a GitHub spec. `@scope/…` and `$VAR/…` are excluded —
 * blocking those risks false positives on registry specs and variable paths;
 * the bare `a/b` shape is the proven trap.
 */
export function isMisparsedTarget(target: string): boolean {
  return (
    normalizePath(target).includes('/') &&
    !target.startsWith('./') &&
    !target.startsWith('../') &&
    !normalizePath(target).startsWith('/') &&
    !target.startsWith('~') &&
    !target.startsWith('@') &&
    !target.startsWith('$')
  )
}

/**
 * Classify one publish invocation's post-`publish` tokens into a PublishHit.
 * Returns undefined for help-only invocations.
 */
function classify(
  tokens: readonly string[],
  source: string,
): PublishHit | undefined {
  if (tokens.includes('--help') || tokens.includes('-h')) {
    return undefined
  }
  let target: string | undefined
  for (let i = 0, { length } = tokens; i < length; i += 1) {
    const token = tokens[i]!
    if (token.startsWith('-')) {
      break
    }
    target = token
    break
  }
  return {
    dryRun: tokens.includes('--dry-run'),
    misparsedArg:
      target !== undefined && isMisparsedTarget(target) ? target : undefined,
    source,
  }
}

/**
 * Scan a Bash command for publish invocations — real ones via the shell AST,
 * snippet-embedded ones (quoted command text handed to printf/echo/pbcopy) via
 * whitespace-token scanning of every parsed string argument.
 */
export function detectPublishes(command: string): PublishHit[] {
  const hits: PublishHit[] = []
  const segments = parseCommands(command)
  for (const segment of segments) {
    // Real invocation: npm|pnpm|yarn with `publish` as the first non-flag arg.
    if ((PUBLISH_BINARIES as readonly string[]).includes(segment.binary)) {
      const { args } = segment
      for (let i = 0, { length } = args; i < length; i += 1) {
        const arg = args[i]!
        if (arg.startsWith('-')) {
          continue
        }
        if (arg === 'publish') {
          const hit = classify(
            args.slice(i + 1),
            `${segment.binary} ${args.join(' ')}`,
          )
          if (hit) {
            hits.push(hit)
          }
        }
        break
      }
    }
    // Embedded snippet: a string argument that itself contains a publish
    // command line (e.g. each line handed to printf for a pbcopy snippet).
    for (const arg of segment.args) {
      if (!arg.includes(' ') || !arg.includes('publish')) {
        continue
      }
      const tokens = arg.split(/\s+/).filter(Boolean)
      for (let i = 0, { length } = tokens; i < length - 1; i += 1) {
        if (
          (PUBLISH_BINARIES as readonly string[]).includes(tokens[i]!) &&
          tokens[i + 1] === 'publish'
        ) {
          const hit = classify(tokens.slice(i + 2), arg)
          if (hit) {
            hits.push(hit)
          }
        }
      }
    }
  }
  return hits
}

/**
 * Did a recent assistant tool call read the registry / release state? Parses
 * each prior Bash command with the shell AST — `npm|pnpm view|info|show`,
 * `gh release view`, `gh api …/releases…`, `cargo search` all count.
 */
export function hasRegistryReadReceipt(
  transcriptPath: string | undefined,
): boolean {
  const events = [
    ...readLastAssistantToolUses(transcriptPath),
    ...readPriorAssistantToolUses(transcriptPath, RECEIPT_LOOKBACK_TURNS),
  ]
  for (let i = 0, { length } = events; i < length; i += 1) {
    const event = events[i]!
    if (event.name !== 'Bash') {
      continue
    }
    const cmd = event.input['command']
    if (typeof cmd !== 'string') {
      continue
    }
    if (isRegistryRead(cmd)) {
      return true
    }
  }
  return false
}

export function isRegistryRead(command: string): boolean {
  for (const binary of ['npm', 'pnpm']) {
    for (const segment of commandsFor(command, binary)) {
      if (
        segment.args.some(
          a =>
            !a.startsWith('-') &&
            (a === 'info' || a === 'show' || a === 'view'),
        )
      ) {
        return true
      }
    }
  }
  for (const segment of commandsFor(command, 'gh')) {
    const bare = segment.args.filter(a => !a.startsWith('-'))
    if (bare[0] === 'release' && bare[1] === 'view') {
      return true
    }
    if (bare[0] === 'api' && bare.some(a => a.includes('/releases'))) {
      return true
    }
  }
  for (const segment of commandsFor(command, 'cargo')) {
    if (segment.args.some(a => !a.startsWith('-') && a === 'search')) {
      return true
    }
  }
  return false
}

export function formatMisparseBlock(hit: PublishHit): string {
  return (
    [
      `[verify-before-publish-guard] Blocked: \`publish ${hit.misparsedArg}\` is a repository spec, not a folder.`,
      '',
      `  npm resolves \`${hit.misparsedArg}\` as \`github.com/${hit.misparsedArg}\` and the`,
      '  publish dies on `git ls-remote`. Prefix the local path:',
      '',
      `    publish ./${hit.misparsedArg}`,
      '',
      `  Bypass: type "${BYPASS_PHRASE}" to allow it for this invocation.`,
    ].join('\n') + '\n'
  )
}

export function formatUnverifiedBlock(hit: PublishHit): string {
  return (
    [
      '[verify-before-publish-guard] Blocked: publish without reading the current published state first.',
      '',
      `  Command: ${hit.source}`,
      '',
      '  A publish is irreversible — a version can never be republished. Read',
      '  the registry state, then retry (the receipt makes this pass):',
      '',
      '    npm view <pkg> version   # or: gh release view <tag>',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" to allow it for this invocation.`,
    ].join('\n') + '\n'
  )
}

export const check = bashGuard((command, payload) => {
  const hits = detectPublishes(command)
  if (hits.length === 0) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, [BYPASS_PHRASE], 3)) {
    return undefined
  }
  const misparsed = hits.find(h => h.misparsedArg)
  if (misparsed) {
    return block(formatMisparseBlock(misparsed))
  }
  const live = hits.find(h => !h.dryRun)
  if (live && !hasRegistryReadReceipt(payload.transcript_path)) {
    return block(formatUnverifiedBlock(live))
  }
  return undefined
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
