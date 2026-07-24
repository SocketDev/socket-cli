#!/usr/bin/env node
// Claude Code PreToolUse hook — verify-before-publish-guard.
//
// BLOCKS three publish-family footguns, in EVERY repo (fleet or external —
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
// 2. Local publish (REDIRECT to the sanctioned pipeline): a live `npm publish`
//    / `pnpm publish` / `pnpm stage publish` run LOCALLY. The fleet publishes
//    from GitHub Actions under OIDC trusted publishing + provenance — there is
//    no local npm login, no local OTP. The block TEACHES the sanctioned entry
//    (release-pipeline.mts → publish-pipeline.mts, whose stage-publish leg
//    DISPATCHES the npm-publish.yml workflow and watches the run) rather than
//    just refusing. Carve-out: the one-time `npm publish` of a `0.0.0`
//    placeholder (npm trusted-publishing bootstrap — see
//    scripts/fleet/publish-infra/npm/placeholder.mts) is ALLOWED; it is the
//    only sanctioned local publish.
//
// 3. Unverified publish: a non-`--dry-run` publish with no same-session
//    registry-read receipt — no `npm view` / `npm info` / `gh release view` in
//    a recent assistant tool call. Publishing is irreversible (a version can
//    never be republished); reading the current published state first is
//    mandatory. Run the read, then retry — the receipt makes the same command
//    pass. (Applies to the placeholder carve-out too: reserving a name is still
//    an irreversible publish.)
//
// 4. Local `cargo publish` (REDIRECT to the cargo engine): a crates.io publish
//    is just as irreversible. The sanctioned entry is cargo-publish.mts, which
//    orders the steps (publish first; tag + GH release LAST, behind crates.io
//    index liveness). A `cargo publish --dry-run` preview passes.
//
// 5. Direct publish-runner invocations (REDIRECT to the pipeline): a live
//    `node scripts/fleet/npm-publish.mts …` run directly publishes from THIS
//    machine and skips the pipeline's receipts (bump → stage-publish → verify
//    → approve → release ordering); `publish-pipeline.mts --local` is the same
//    local-publish escape. Both are for humans / genuinely offline use — an
//    agent goes through `publish-pipeline.mts` (no --local), whose publish leg
//    dispatches CI. `--dry-run` invocations pass.
//
// Detection is AST-based (`parseCommands` on the fleet shell parser) for real
// invocations; snippet-embedded publishes are found by whitespace-token
// scanning of string arguments — no command-matching regexes.
//
// Fails open on parse / payload errors — a guard bug must not wedge every Bash
// call.

import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import {
  commandsFor,
  commandWorkingDir,
  parseCommands,
} from '../_shared/shell-command.mts'
import {
  readLastAssistantToolUses,
  readPriorAssistantToolUses,
} from '../_shared/transcript.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const PUBLISH_BINARIES = ['npm', 'pnpm', 'yarn'] as const

// The sanctioned-local-publish carve-out: a placeholder reservation is pinned to
// this version (see scripts/fleet/publish-infra/npm/placeholder.mts). A publish
// of a package whose local package.json is at this version is the trusted-
// publishing bootstrap, NOT a real release, so it is exempt from the remote
// redirect.
export const PLACEHOLDER_VERSION = '0.0.0'

// Flags whose following value is prose (commit messages, PR/issue bodies,
// release notes) — never an executable snippet, so the embedded-command scan
// skips it.
const PROSE_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--body',
  '--message',
  '--notes',
  '--title',
  '-m',
])
// The inline `--flag=value` forms of the same prose flags.
const PROSE_INLINE_FLAG_RE = /^--(?:body|message|notes|title)=/ // socket-lint: allow uncommented-regex

// How many prior assistant turns to scan for a registry-read receipt.
const RECEIPT_LOOKBACK_TURNS = 5

export const triggers: readonly string[] = ['publish']

export interface PublishHit {
  readonly dryRun: boolean
  readonly misparsedArg: string | undefined
  readonly source: string
  // The first non-flag token after `publish` (the target), or undefined for a
  // bare `publish` / `pnpm stage publish`. Used to locate the local
  // package.json for the placeholder carve-out.
  readonly target: string | undefined
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
    target,
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
    // Message-flag VALUES are prose, not snippets — a commit message or PR
    // body that merely mentions "npm publish" must not fire (live incident:
    // a multiline `git commit -m` describing publish behavior was blocked).
    const { args } = segment
    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (PROSE_VALUE_FLAGS.has(arg)) {
        i += 1
        continue
      }
      if (PROSE_INLINE_FLAG_RE.test(arg)) {
        continue
      }
      if (!arg.includes(' ') || !arg.includes('publish')) {
        continue
      }
      const tokens = arg.split(/\s+/).filter(Boolean)
      for (let j = 0, tl = tokens.length; j < tl - 1; j += 1) {
        if (
          (PUBLISH_BINARIES as readonly string[]).includes(tokens[j]!) &&
          tokens[j + 1] === 'publish'
        ) {
          const hit = classify(tokens.slice(j + 2), arg)
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
 * Detect `pnpm stage publish` — the staged upload step. `detectPublishes` keys
 * off `publish` as the FIRST non-flag arg, so `stage publish` (publish is the
 * SECOND) slips past it; this catches it explicitly. The staged upload is meant
 * to run in CI under the OIDC token, so a LOCAL `pnpm stage publish` is a
 * redirect candidate just like a bare `pnpm publish`.
 */
export function detectStagePublish(command: string): PublishHit[] {
  const hits: PublishHit[] = []
  for (const segment of commandsFor(command, 'pnpm')) {
    const bare = segment.args.filter(a => !a.startsWith('-'))
    if (bare[0] === 'stage' && bare[1] === 'publish') {
      hits.push({
        dryRun: segment.args.includes('--dry-run'),
        misparsedArg: undefined,
        source: `pnpm ${segment.args.join(' ')}`,
        target: undefined,
      })
    }
  }
  return hits
}

/**
 * Detect a local `cargo publish`. Same redirect posture as the npm family: a
 * crates.io publish is irreversible, and the sanctioned entry is the cargo
 * engine (cargo-publish.mts), which orders publish → liveness → tag+release.
 * `--dry-run` is a harmless preview and is marked as such.
 */
export function detectCargoPublish(command: string): PublishHit[] {
  const hits: PublishHit[] = []
  for (const segment of commandsFor(command, 'cargo')) {
    const bare = segment.args.filter(a => !a.startsWith('-'))
    if (bare[0] === 'publish') {
      hits.push({
        dryRun: segment.args.includes('--dry-run'),
        misparsedArg: undefined,
        source: `cargo ${segment.args.join(' ')}`,
        target: undefined,
      })
    }
  }
  return hits
}

// The publish-runner scripts an agent must not invoke directly: running them
// from a local shell publishes from THIS machine, outside the pipeline's
// receipts. The pipeline itself spawns npm-publish.mts as a CHILD process
// (never a Bash tool command), so blocking the Bash shape never breaks it.
const DIRECT_PUBLISH_SCRIPT_RE = /(?:^|\/)scripts\/fleet\/npm-publish\.mts$/
const PUBLISH_PIPELINE_SCRIPT_RE =
  /(?:^|\/)scripts\/fleet\/publish-pipeline\.mts$/

/**
 * Detect a direct local publish-runner invocation: `node …npm-publish.mts`
 * (any mode — --staged uploads, --approve standalone cuts its own tag +
 * release) or `node …publish-pipeline.mts --local` (the explicit local-publish
 * escape). The plain `publish-pipeline.mts` (no --local) is the SANCTIONED
 * entry and never hits.
 */
export function detectDirectPublishScript(command: string): PublishHit[] {
  const hits: PublishHit[] = []
  for (const segment of commandsFor(command, 'node')) {
    const script = segment.args.find(a => !a.startsWith('-'))
    if (!script) {
      continue
    }
    const unix = normalizePath(script)
    const isDirectRunner = DIRECT_PUBLISH_SCRIPT_RE.test(unix)
    const isLocalPipeline =
      PUBLISH_PIPELINE_SCRIPT_RE.test(unix) && segment.args.includes('--local')
    if (!isDirectRunner && !isLocalPipeline) {
      continue
    }
    hits.push({
      dryRun: segment.args.includes('--dry-run'),
      misparsedArg: undefined,
      source: `node ${segment.args.join(' ')}`,
      target: undefined,
    })
  }
  return hits
}

/**
 * Resolve the local directory a publish acts on: a path-ish target
 * (`./dir`, `../dir`, `/abs`, `~/dir`) resolved against the command's effective
 * working dir; otherwise that working dir itself (a bare `publish` /
 * `pnpm stage publish`). Registry-ish targets (bare `a/b`, `@scope/x`, `$VAR`)
 * carry no local package.json, so they fall back to the working dir.
 */
function resolvePublishDir(
  command: string,
  target: string | undefined,
): string {
  const baseDir = commandWorkingDir(command)
  if (
    !target ||
    !(
      target.startsWith('./') ||
      target.startsWith('../') ||
      path.isAbsolute(target) ||
      target.startsWith('~')
    )
  ) {
    return baseDir
  }
  const expanded =
    target === '~'
      ? os.homedir()
      : target.startsWith('~/')
        ? path.join(os.homedir(), target.slice(2))
        : target
  return path.resolve(baseDir, expanded)
}

/**
 * Read the `version` from the package.json a publish would ship. Returns
 * undefined when there is no readable/parseable manifest at the resolved dir.
 */
export function readPublishTargetVersion(
  command: string,
  target: string | undefined,
): string | undefined {
  const pkgPath = path.join(resolvePublishDir(command, target), 'package.json')
  try {
    if (!existsSync(pkgPath)) {
      return undefined
    }
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      version?: unknown | undefined
    }
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

/**
 * True when this publish is the sanctioned trusted-publishing bootstrap: the
 * package it ships is at the `0.0.0` placeholder version. Only such a publish
 * is allowed to run locally; every other local publish is redirected to CI.
 */
export function isPlaceholderBootstrap(
  command: string,
  target: string | undefined,
): boolean {
  return readPublishTargetVersion(command, target) === PLACEHOLDER_VERSION
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
    ].join('\n') + '\n'
  )
}

export function formatRemoteRedirectBlock(hit: PublishHit): string {
  return (
    [
      '[verify-before-publish-guard] Blocked: local publish. Publishing runs in CI, not on your machine.',
      '',
      `  Command: ${hit.source}`,
      '',
      '  Releases publish from GitHub Actions under OIDC trusted publishing +',
      '  provenance — no local npm login, no local OTP. The sanctioned entry is',
      '  the pipeline; its stage-publish leg dispatches the npm-publish.yml',
      '  workflow and watches the run:',
      '',
      '    node scripts/fleet/release-pipeline.mts --version X.Y.Z  # readiness → bump',
      '    node scripts/fleet/publish-pipeline.mts                  # stage-publish (CI) → verify',
      '    node scripts/fleet/publish-pipeline.mts --approve        # 2FA promote → tag + GH release LAST',
      '',
      '  Genuinely offline? The USER runs the pipeline with --local — an agent',
      '  never publishes from the local machine.',
      '',
      '  Carve-out: the one-time `npm publish` of a 0.0.0 placeholder (the npm',
      '  trusted-publishing bootstrap — scripts/fleet/publish-infra/npm/placeholder.mts)',
      '  is allowed.',
    ].join('\n') + '\n'
  )
}

export function formatCargoRedirectBlock(hit: PublishHit): string {
  return (
    [
      '[verify-before-publish-guard] Blocked: local `cargo publish` outside the cargo engine.',
      '',
      `  Command: ${hit.source}`,
      '',
      '  A crates.io publish is irreversible — a version can never be',
      '  re-published. The sanctioned entry is the cargo engine, which orders',
      '  the steps (publish first; tag + immutable GH release LAST, behind',
      '  crates.io index liveness):',
      '',
      '    node scripts/fleet/cargo-publish.mts --approve',
      '',
      '  A `cargo publish --dry-run` preview passes this guard.',
    ].join('\n') + '\n'
  )
}

export function formatDirectScriptBlock(hit: PublishHit): string {
  return (
    [
      '[verify-before-publish-guard] Blocked: direct publish-runner invocation — this publishes from the local machine.',
      '',
      `  Command: ${hit.source}`,
      '',
      '  `npm-publish.mts` run directly (and `publish-pipeline.mts --local`)',
      '  publishes from THIS machine and skips the pipeline receipts (bump →',
      '  stage-publish → verify → approve → release, the tag + GH release cut',
      '  LAST behind registry liveness). The sanctioned entry:',
      '',
      '    node scripts/fleet/publish-pipeline.mts            # stage-publish dispatches npm-publish.yml → verify',
      '    node scripts/fleet/publish-pipeline.mts --approve  # 2FA promote → tag + GH release LAST',
      '',
      '  --local / the direct runner are for humans on a genuinely offline',
      '  machine. A `--dry-run` invocation passes this guard.',
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
    ].join('\n') + '\n'
  )
}

export const check = bashGuard((command, payload) => {
  const publishHits = detectPublishes(command)
  const stageHits = detectStagePublish(command)
  const cargoHits = detectCargoPublish(command)
  const scriptHits = detectDirectPublishScript(command)
  const hits = [...publishHits, ...stageHits, ...cargoHits, ...scriptHits]
  if (hits.length === 0) {
    return undefined
  }
  // A broken git-spec target is the most urgent (the command can't succeed).
  const misparsed = publishHits.find(h => h.misparsedArg)
  if (misparsed) {
    return block(formatMisparseBlock(misparsed))
  }
  // A live local `cargo publish` / direct publish-runner script is always a
  // redirect (no placeholder analog). A --dry-run preview passes.
  const liveCargo = cargoHits.find(h => !h.dryRun)
  if (liveCargo) {
    return block(formatCargoRedirectBlock(liveCargo))
  }
  const liveScript = scriptHits.find(h => !h.dryRun)
  if (liveScript) {
    return block(formatDirectScriptBlock(liveScript))
  }
  // Redirect a LIVE local publish to the pipeline, unless it is the
  // sanctioned 0.0.0 placeholder bootstrap. A --dry-run publish is a harmless
  // preview and passes.
  const liveLocal = [...publishHits, ...stageHits].find(h => !h.dryRun)
  if (liveLocal && !isPlaceholderBootstrap(command, liveLocal.target)) {
    return block(formatRemoteRedirectBlock(liveLocal))
  }
  // The placeholder carve-out (or a receipt-less live publish that slipped the
  // redirect) still owes a registry-read receipt — reserving/publishing a
  // version is irreversible.
  const live = hits.find(h => !h.dryRun)
  if (live && !hasRegistryReadReceipt(payload.transcript_path)) {
    return block(formatUnverifiedBlock(live))
  }
  return undefined
})

export const hook = defineHook({
  bypass: ['verify-before-publish'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
