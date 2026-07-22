#!/usr/bin/env node
// Claude Code PreToolUse hook — bump-defers-to-release-guard.
//
// Blocks a version bump outside the release workflow, in either vector:
//   - a `bump.mts` WRITE run (no --dry-run) or an `npm|pnpm|yarn version <arg>`
//     mutation (Bash), or
//   - a MANUAL Edit/Write to package.json's `version` field, or a CHANGELOG.md
//     release entry.
// Both are the same anti-pattern: the release workflow (npm-publish.mts --bump)
// OWNS the version bump + CHANGELOG. Prepping them by hand BEFORE triggering the
// release skips versions — package.json pre-bumped to 1.4.3, then the workflow
// bumped 1.4.3 → 1.4.4, so 1.4.3 was never published. The VERSION is the user's
// decision; derived bumps are patch/minor (patch default), MAJOR never derived.
//
// The sanctioned flow: gather evidence with `bump.mts --dry-run` (always
// allowed), present the version question to the user, and STOP. After the
// user names the version they authorize the run with `Allow release-bump
// bypass`; a MAJOR run additionally requires `Allow major-bump bypass`. In
// CI, major happens only when a human manually selected it on the
// workflow_dispatch form (this hook never runs there).
//
// This guard exists because an agent once decided a major bump from
// export-surface evidence, authored a synthetic `refactor!:` commit to steer
// the CHANGELOG generator, and ran the bump, all unilaterally.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { parseVersion } from '@socketsecurity/lib-stable/versions/parse'

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { readFilePath, readWriteContent } from '../_shared/payload.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// True when a version string carries the `-prerelease` hint tag.
function isPrereleaseHint(version: string | undefined): boolean {
  return (
    typeof version === 'string' &&
    parseVersion(version)?.prerelease.join('.') === 'prerelease'
  )
}

// The `-prerelease` hint for a cargo repo, which carries its version in
// Cargo.toml, not package.json: a workspace repo pins it under
// `[workspace.package]`, a single-crate repo under a member's `[package]`
// (`version.workspace = true` members defer to the workspace pin). Exported for
// tests — takes the project dir so it needs no env.
export function cargoVersionHint(dir: string): boolean {
  try {
    const rootToml = readFileSync(path.join(dir, 'Cargo.toml'), 'utf8')
    const wsVersion = rootToml.match(
      /\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/,
    )?.[1]
    if (isPrereleaseHint(wsVersion)) {
      return true
    }
  } catch {}
  let members: string[]
  try {
    members = readdirSync(path.join(dir, 'crates'))
  } catch {
    return false
  }
  for (let i = 0, { length } = members; i < length; i += 1) {
    let toml: string
    try {
      toml = readFileSync(
        path.join(dir, 'crates', members[i]!, 'Cargo.toml'),
        'utf8',
      )
    } catch {
      continue
    }
    const pkgVersion = toml.match(
      /\[package\][^[]*?\nversion\s*=\s*"([^"]+)"/,
    )?.[1]
    if (isPrereleaseHint(pkgVersion)) {
      return true
    }
  }
  return false
}

// True when the checked-out tree carries a `-prerelease` version hint
// (`X.Y.Z-prerelease`) — in package.json (npm) or Cargo.toml (cargo). The human
// wrote the release target into the tree, so a non-major bump that consumes it
// is already user-authorized.
export function committedVersionHint(): boolean {
  const dir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(dir, 'package.json'), 'utf8'),
    ) as {
      version?: string
    }
    if (isPrereleaseHint(pkg.version)) {
      return true
    }
  } catch {}
  return cargoVersionHint(dir)
}

const BYPASS_PHRASE = 'Allow release-bump bypass'
const MAJOR_BYPASS_PHRASE = 'Allow major-bump bypass'

// Version-mutating package-manager binaries: `<binary> version <arg>` writes
// package.json (a bare `npm version` only prints and passes untouched).
const PM_BINARIES: readonly string[] = ['npm', 'pnpm', 'yarn']

// npm-version bump keywords that produce a MAJOR.
const MAJOR_ARGS: readonly string[] = ['major', 'premajor']

// Pre-flight skip set: the dispatcher only imports this guard when the raw
// payload contains one of these substrings.
export const triggers: readonly string[] = [
  'CHANGELOG',
  'bump.mts',
  'npm version',
  'package.json',
  'pnpm version',
  'yarn version',
]

export interface BumpViolation {
  readonly invocation: string
  readonly major: boolean
}

// The offending invocation, or undefined when the command is clean. A
// `bump.mts` run only counts as a WRITE run without `--dry-run`; a
// package-manager `version` subcommand only counts with a mutation argument.
export function bumpViolationIn(command: string): BumpViolation | undefined {
  for (const cmd of commandsFor(command, 'node')) {
    const script = cmd.args.find(a => a.endsWith('bump.mts'))
    if (script && !cmd.args.includes('--dry-run')) {
      const releaseAs = cmd.args[cmd.args.indexOf('--release-as') + 1]
      return {
        invocation: `node ${script}`,
        major:
          cmd.args.includes('--release-as') &&
          MAJOR_ARGS.includes(releaseAs ?? ''),
      }
    }
  }
  for (let i = 0, { length } = PM_BINARIES; i < length; i += 1) {
    const binary = PM_BINARIES[i]!
    for (const cmd of commandsFor(command, binary)) {
      if (cmd.args[0] === 'version' && cmd.args.length > 1) {
        return {
          invocation: `${binary} version`,
          major: cmd.args.some(a => MAJOR_ARGS.includes(a)),
        }
      }
    }
  }
  return undefined
}

// The manual-edit vector of the SAME anti-pattern: hand-editing package.json's
// `version` (a pre-release bump) or writing a CHANGELOG release entry. The
// release workflow (npm-publish.mts --bump) owns BOTH — pre-bumping by hand is
// what skipped 1.4.3 (package.json pre-set to 1.4.3, then the workflow bumped
// 1.4.3 → 1.4.4, so 1.4.3 was never published). Compares the incoming version
// to the on-disk one, so a same-version edit (touching other keys) is clean.
export function manualBumpViolation(
  filePath: string,
  content: string | undefined,
): BumpViolation | undefined {
  if (!content) {
    return undefined
  }
  const base = path.basename(normalizePath(filePath))
  if (base === 'package.json') {
    const incoming = /"version"\s*:\s*"([^"]+)"/.exec(content)?.[1]
    if (!incoming) {
      return undefined
    }
    let current: string | undefined
    try {
      current = (
        JSON.parse(readFileSync(filePath, 'utf8')) as { version?: string }
      ).version
    } catch {
      current = undefined
    }
    if (!current || current === incoming) {
      return undefined
    }
    const cur = parseVersion(current)
    const inc = parseVersion(incoming)
    return {
      invocation: `manual package.json version bump ${current} → ${incoming}`,
      major: !!(cur && inc && inc.major > cur.major),
    }
  }
  if (base === 'CHANGELOG.md' && /^##\s+\[?v?\d+\.\d+\.\d+/m.test(content)) {
    return { invocation: 'manual CHANGELOG.md release entry', major: false }
  }
  return undefined
}

// Decide what (if anything) to block for a payload. Pure — the test drives
// it directly. A Bash command bump OR a manual Edit/Write to package.json /
// CHANGELOG.md — both defer to the release workflow.
export function bumpViolation(
  payload: ToolCallPayload,
): BumpViolation | undefined {
  const tool = payload.tool_name
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write') {
    const filePath = readFilePath(payload)
    return filePath
      ? manualBumpViolation(filePath, readWriteContent(payload))
      : undefined
  }
  if (tool !== 'Bash') {
    return undefined
  }
  const command = payload.tool_input?.command
  if (typeof command !== 'string') {
    return undefined
  }
  return bumpViolationIn(command)
}

export function check(payload: ToolCallPayload): GuardResult {
  const violation = bumpViolation(payload)
  if (!violation) {
    return undefined
  }
  // A committed `-prerelease` version hint (e.g. 6.0.10-prerelease) IS the
  // user's named version — the hint convention exists so the human writes
  // the target into package.json and the release tooling consumes it.
  // A non-major bump under a committed hint is therefore pre-authorized;
  // MAJOR still demands its explicit phrase.
  if (!violation.major && committedVersionHint()) {
    return undefined
  }
  const authorized =
    payload.transcript_path !== undefined &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  const majorAuthorized =
    payload.transcript_path !== undefined &&
    bypassPhrasePresent(payload.transcript_path, MAJOR_BYPASS_PHRASE)
  if (authorized && (!violation.major || majorAuthorized)) {
    return undefined
  }
  const majorLine = violation.major
    ? `  This is a MAJOR bump — it additionally requires: ${MAJOR_BYPASS_PHRASE}`
    : `  A MAJOR bump would additionally require: ${MAJOR_BYPASS_PHRASE}`
  return block(
    [
      '[bump-defers-to-release-guard] Blocked: agent-driven version bump.',
      '',
      `  What:  ${violation.invocation}.`,
      '         The release workflow (npm-publish.mts --bump) OWNS the version +',
      '         CHANGELOG — pre-bumping by hand skips versions (it skipped 1.4.3).',
      '  Where: the release surface. The VERSION is the USER’s decision,',
      '         never the agent’s: derived bumps are patch or minor (patch',
      '         default), MAJOR is never derived, and the bump + CHANGELOG',
      '         belong to the release workflow/scripts.',
      '',
      '  Fix:   (1) gather evidence with `node scripts/fleet/bump.mts --dry-run`',
      '             (always allowed);',
      '         (2) present the version question to the user and STOP;',
      '         (3) after the user names X.Y.Z they authorize the run by',
      `             typing: ${BYPASS_PHRASE}`,
      majorLine,
      '  In CI, major happens only when a human selects it on the',
      '  workflow_dispatch form.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['release-bump', 'major-bump'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash', 'Edit', 'MultiEdit', 'Write'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
