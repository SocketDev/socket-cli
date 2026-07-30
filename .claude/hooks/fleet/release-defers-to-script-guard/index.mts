#!/usr/bin/env node
// Claude Code PreToolUse hook — release-defers-to-script-guard.
//
// Makes the agent STOP reasoning about releases and just run the code-is-law
// release scripts. In a fleet-managed repo the release + publish pipeline
// scripts OWN every release step — readiness, the version bump, the changelog,
// the registry stage, the approve, the tag, and the GitHub release. So this
// guard BLOCKS a HAND-ROLLED release step run from Bash, because reaching for
// one means the agent is doing by hand what the script already owns end to end.
//
// BLOCKED hand-rolled steps:
//   - `npm|pnpm|yarn version <arg>` — a manifest version mutation. A bare `npm
//     version` with no argument only prints, so it passes.
//   - `npm|pnpm|yarn publish` — a registry publish.
//   - `npm pkg set version=<x>` — a manifest version write by another route.
//   - a package.json "version" edit via sed, perl, or jq, or a shell redirect
//     that writes package.json a version value.
//   - `git tag <v-semver>` — creating a release tag, and `git push --tags` /
//     `git push --follow-tags` / `git push <remote> <v-semver>` — pushing one.
//   - a direct `node scripts/fleet/bump.mts` run — the bump is reached only
//     THROUGH the pipeline, never called directly.
//
// ALLOWED, never blocked:
//   - `node scripts/fleet/release-pipeline.mts` with any args, with or without
//     `--version`. The script derives or consumes the version, prerelease hints
//     included, so the agent must NOT reason about which version to pass.
//   - `node scripts/fleet/publish-pipeline.mts` with any args.
//   - read-only git — status, log, diff, `tag -l`, show — and every non-release
//     command.
//
// The decision is a PURE function, decideReleaseGuard, over the parsed command,
// so it is exhaustively unit-tested without touching the filesystem. Each git,
// npm, pnpm, and yarn segment is AST-parsed via commandsFor — robust to leading
// env assignments, `git -C <path>`, quoting, and `&&` / `;` chains — so a quoted
// "npm publish" inside a message never false-fires.
//
// Does NOT fire when:
//   - the context is CI — CI / GITHUB_ACTIONS / CONTINUOUS_INTEGRATION set. CI
//     runs the release through its own workflow, not an interactive agent.
//   - the acted-on repo is not fleet-managed — scope 'convention' stands the
//     hook down in a foreign repo.
//
// Bypass: `Allow release-script bypass` typed verbatim in a recent user turn.
//
// Fails open on parse / payload errors — a guard bug must not wedge every Bash
// call.

import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { extractGitCwd } from '../_shared/git-cwd.mts'
import {
  splitGitSubcommand,
  splitSubcommandArgs,
} from '../_shared/git-subcommand.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// Pre-flight skip hint: detection only fires when one of these appears in the
// raw command. The manifest-edit vectors all name package.json, so that token
// covers the sed / perl / jq / redirect cases without listing those binaries.
export const triggers: readonly string[] = [
  'git',
  'node',
  'npm',
  'package.json',
  'pnpm',
  'yarn',
]

// Stable identifier for CI scripts / ndjson reporters to branch on instead of
// substring-matching the human message.
export const ERR_RELEASE_DEFERS_TO_SCRIPT = 'ERR_FLEET_RELEASE_DEFERS_TO_SCRIPT'

// Package-manager global options that consume the following token as their
// value, so the subcommand scan skips both.
const PM_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--dir',
  '--filter',
  '--prefix',
  '--workspace',
  '-C',
  '-F',
  '-w',
])

// `git tag` options that consume the following token, so a value like a tag
// message is never misread as a positional release tag.
const TAG_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--file',
  '--local-user',
  '--message',
  '-F',
  '-m',
  '-u',
])

// `git push` options that consume the following token.
const PUSH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--exec',
  '--push-option',
  '--receive-pack',
  '--repo',
  '-o',
])

// The package managers whose `version` / `publish` / `pkg set version`
// subcommands mutate a release, listed for the segment scan.
const PM_BINARIES: readonly string[] = ['npm', 'pnpm', 'yarn']

// The tools that can rewrite package.json's version in place from Bash.
const EDIT_BINARIES: readonly string[] = ['jq', 'perl', 'sed']

// A release tag: an optional `v` prefix then a full semver, anchored end to end
// so a tag message like `1.2.3 ships` never matches. A `refs/tags/` lead is
// stripped first so a fully-qualified push refspec still resolves.
const RELEASE_TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

// A version-write signal in a manifest edit: the JSON key `"version"`, a jq
// `.version` path, or a `version=` / `version:` assignment. Names no shell
// binary, so it is not a command-parsing regex.
const VERSION_WRITE_TOKEN_RE = /"version"|\.version\b|version\s*[:=]/

// A shell redirect target: the token after `>` or `>>`. Captures the path so a
// redirect that writes package.json can be recognized, since the AST parser
// drops redirect operands from a segment's args.
const REDIRECT_TARGET_RE = /(?:^|[\s|&;])>>?\s*['"]?([^\s'"|&;<>]+)/g

/**
 * A release-guard verdict. `blocked: false` allows; a block carries a human
 * `reason` label for the hand-rolled step it fired on — `npm publish`, `git tag
 * v1.2.3`.
 */
export interface ReleaseGuardDecision {
  readonly blocked: boolean
  readonly reason?: string | undefined
}

const ALLOW: ReleaseGuardDecision = { blocked: false }

// True when `arg` names a release tag, with a `refs/tags/` prefix stripped so a
// fully-qualified push refspec still resolves.
function isReleaseTag(arg: string): boolean {
  const ref = arg.startsWith('refs/tags/')
    ? arg.slice('refs/tags/'.length)
    : arg
  return RELEASE_TAG_RE.test(ref)
}

// The first positional token that names a release tag, skipping value-flag
// values so a `-m <message>` value is never mistaken for one.
function positionalReleaseTag(
  args: readonly string[],
  valueFlags: ReadonlySet<string>,
): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg.startsWith('-')) {
      if (valueFlags.has(arg)) {
        i += 1
      }
      continue
    }
    if (isReleaseTag(arg)) {
      return arg
    }
  }
  return undefined
}

// True when `arg` is a path whose basename is package.json.
function isPackageJsonArg(arg: string): boolean {
  const normalized = normalizePath(arg)
  return normalized === 'package.json' || normalized.endsWith('/package.json')
}

// True when the raw command redirects into package.json with `>` or `>>`.
function hasPackageJsonRedirect(command: string): boolean {
  REDIRECT_TARGET_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = REDIRECT_TARGET_RE.exec(command)) !== null) {
    if (isPackageJsonArg(match[1]!)) {
      return true
    }
  }
  return false
}

// The direct `bump.mts` run in a `node` segment, or undefined. Matches the bump
// script on a path-segment boundary so a sibling like `lockstep/auto-bump.mts`
// — a different surface with its own flow — passes untouched.
function directBumpReason(command: string): string | undefined {
  for (const cmd of commandsFor(command, 'node')) {
    const script = cmd.args.find(arg => {
      const normalized = normalizePath(arg)
      return normalized === 'bump.mts' || normalized.endsWith('/bump.mts')
    })
    if (script) {
      return `node ${script}`
    }
  }
  return undefined
}

// The package-manager release mutation in `command`, or undefined. A `version`
// subcommand counts only with a mutating argument; a bare `<pm> version` prints
// and passes.
function packageManagerReason(command: string): string | undefined {
  for (let i = 0, { length } = PM_BINARIES; i < length; i += 1) {
    const binary = PM_BINARIES[i]!
    for (const cmd of commandsFor(command, binary)) {
      const { rest, sub } = splitSubcommandArgs(cmd.args, PM_VALUE_FLAGS)
      if (sub === 'version' && rest.length > 0) {
        return `${binary} version`
      }
      if (sub === 'publish') {
        return `${binary} publish`
      }
      if (
        binary === 'npm' &&
        sub === 'pkg' &&
        rest.includes('set') &&
        rest.some(arg => arg === 'version' || arg.startsWith('version='))
      ) {
        return 'npm pkg set version'
      }
    }
  }
  return undefined
}

// The release-tag create or push in a `git` segment, or undefined. A `git tag`
// listing — `-l` / `--list` — is read-only and passes; a `git push` is a
// release only when it carries `--tags` / `--follow-tags` or a v-semver
// refspec.
function gitTagReason(command: string): string | undefined {
  for (const cmd of commandsFor(command, 'git')) {
    const { rest, sub } = splitGitSubcommand(cmd.args)
    if (sub === 'tag') {
      if (rest.includes('-l') || rest.includes('--list')) {
        continue
      }
      const tag = positionalReleaseTag(rest, TAG_VALUE_FLAGS)
      if (tag) {
        return `git tag ${tag}`
      }
    }
    if (sub === 'push') {
      if (rest.includes('--tags')) {
        return 'git push --tags'
      }
      if (rest.includes('--follow-tags')) {
        return 'git push --follow-tags'
      }
      const tag = positionalReleaseTag(rest, PUSH_VALUE_FLAGS)
      if (tag) {
        return `git push ${tag}`
      }
    }
  }
  return undefined
}

// A package.json "version" edit via sed / perl / jq, or a shell redirect that
// writes package.json a version value, or undefined. The tool vectors need both
// a package.json arg and a version-write token; the redirect vector needs a
// package.json target and a version-write token anywhere in the command.
function packageJsonVersionEditReason(command: string): string | undefined {
  for (let i = 0, { length } = EDIT_BINARIES; i < length; i += 1) {
    const binary = EDIT_BINARIES[i]!
    for (const cmd of commandsFor(command, binary)) {
      if (
        cmd.args.some(isPackageJsonArg) &&
        cmd.args.some(arg => VERSION_WRITE_TOKEN_RE.test(arg))
      ) {
        return `${binary} package.json version edit`
      }
    }
  }
  if (hasPackageJsonRedirect(command) && VERSION_WRITE_TOKEN_RE.test(command)) {
    return 'package.json version edit'
  }
  return undefined
}

/**
 * Decide whether a Bash `command` must be blocked as a hand-rolled release
 * step. Pure — no filesystem, no environment. Evaluates every git / npm / pnpm
 * / yarn / node segment of a chained command, plus a manifest-edit vector via
 * sed / perl / jq or a shell redirect.
 *
 * BLOCKS a manifest version mutation, a registry publish, a release tag create
 * or push, and a direct bump run. ALLOWS the sanctioned release-pipeline.mts /
 * publish-pipeline.mts scripts with any args, read-only git, and everything
 * else — those simply match no rule.
 */
export function decideReleaseGuard(command: string): ReleaseGuardDecision {
  const reason =
    directBumpReason(command) ??
    packageManagerReason(command) ??
    gitTagReason(command) ??
    packageJsonVersionEditReason(command)
  return reason ? { blocked: true, reason } : ALLOW
}

/**
 * True when the environment looks like CI, where the release runs through its
 * own workflow rather than an interactive agent.
 */
export function isCiEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env['CI'] || env['GITHUB_ACTIONS'] || env['CONTINUOUS_INTEGRATION'],
  )
}

export function formatBlock(
  decision: ReleaseGuardDecision,
  repoDir: string,
): string {
  const reason = decision.reason ?? 'a hand-rolled release step'
  return (
    [
      `[release-defers-to-script-guard] Blocked: ${reason} — the release is code-is-law. [${ERR_RELEASE_DEFERS_TO_SCRIPT}]`,
      '',
      `  What:  ${reason}. In a fleet-managed repo the release + publish pipeline`,
      '         scripts OWN every step: readiness, the version bump, the',
      '         changelog, the registry stage, the approve, the tag, and the',
      '         GitHub release. A hand-rolled step does by hand what the script',
      '         already owns end to end.',
      `  Where: ${repoDir} — the release surface.`,
      `  Saw:   ${reason}.`,
      '  Fix:   run the two pipeline scripts and let them own every step:',
      '           node scripts/fleet/release-pipeline.mts  — readiness, bump, changelog.',
      '           node scripts/fleet/publish-pipeline.mts  — stage, approve, tag, release.',
      '         Do NOT hand-roll the version, bump, tag, or publish, and do NOT',
      '         reason about version mechanics: the script owns them, prerelease',
      '         hints and all.',
    ].join('\n') + '\n'
  )
}

export const check = bashGuard(command => {
  // CI runs the release through its own workflow — no interactive agent to gate.
  if (isCiEnv(process.env)) {
    return undefined
  }
  const decision = decideReleaseGuard(command)
  if (!decision.blocked) {
    return undefined
  }
  return block(formatBlock(decision, extractGitCwd(command)))
})

export const hook = defineHook({
  bypass: ['release-script'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
