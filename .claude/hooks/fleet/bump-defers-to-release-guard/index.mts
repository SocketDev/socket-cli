#!/usr/bin/env node
// Claude Code PreToolUse hook — bump-defers-to-release-guard.
//
// Blocks an agent-driven version bump: a `bump.mts` WRITE run (no --dry-run)
// or an `npm|pnpm|yarn version <arg>` mutation. The VERSION is the user's
// decision. Derived bumps are patch or minor with patch the default; MAJOR
// is never derived and never the agent's call. The bump commit + CHANGELOG
// belong to the release workflow/scripts.
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

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

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
  'bump.mts',
  'npm version',
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

// Decide what (if anything) to block for a payload. Pure — the test drives
// it directly.
export function bumpViolation(
  payload: ToolCallPayload,
): BumpViolation | undefined {
  if (payload.tool_name !== 'Bash') {
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
      `  What:  \`${violation.invocation}\` writes the version + CHANGELOG.`,
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
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
