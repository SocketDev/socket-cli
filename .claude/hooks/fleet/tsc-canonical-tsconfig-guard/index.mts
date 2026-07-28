#!/usr/bin/env node
// Claude Code PreToolUse hook — tsc-canonical-tsconfig-guard.
//
// Makes the agent type-check through the CANONICAL check config instead of a
// hand-picked tsconfig. Fleet repos carry more than one tsconfig: the
// repo-root tsconfig.json is a base/editor config, while the check surface —
// the one `pnpm run check` runs — is `.config/fleet/tsconfig.check.json`,
// which enables allowImportingTsExtensions for the `.mts`-extension imports
// every hook and fleet script uses. A raw `tsc --noEmit -p tsconfig.json`
// or a bare `tsc --noEmit` therefore produces a wall of TS5097
// "import path can only end with .mts" noise that reads as real breakage
// and sends the session chasing phantom errors — the exact time sink this
// guard exists to close.
//
// BLOCKED: a Bash segment that runs tsc with `--noEmit` where the
// `-p`/`--project` value is missing or points outside `.config/` —
//   - `tsc --noEmit`, `tsc --noEmit -p tsconfig.json`
//   - `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
//   - `pnpm exec tsc --noEmit`
//
// ALLOWED, never blocked:
//   - `tsc --noEmit -p .config/fleet/tsconfig.check.json` — the canonical
//     check surface, any `.config/`-rooted project file.
//   - `pnpm run check` and the check scripts — they match no rule here.
//   - tsc WITHOUT `--noEmit` — a build invocation is a different surface.
//
// The decision is a PURE function, decideTscTsconfigGuard, over the parsed
// command, so it is exhaustively unit-tested without touching the filesystem.
// Segments are AST-parsed via commandsFor — robust to env assignments,
// quoting, and `&&` / `;` / `|` chains — so a quoted "tsc --noEmit" inside a
// commit message never false-fires.
//
// Does NOT fire when:
//   - the context is CI — CI runs the gates through its own workflow.
//   - the acted-on repo is not fleet-managed — scope 'convention' stands the
//     hook down in a foreign repo.
//
// Bypass: `Allow tsc-raw-tsconfig bypass` typed verbatim in a recent user
// turn — for the genuine case of type-checking a non-fleet project file.
//
// Fails open on parse / payload errors — a guard bug must not wedge every
// Bash call.

import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// Pre-flight skip hint: detection only fires when this appears in the raw
// command, so the dispatcher skips importing the hook otherwise.
export const triggers: readonly string[] = ['tsc']

// Stable identifier for CI scripts / ndjson reporters to branch on instead of
// substring-matching the human message.
export const ERR_TSC_CANONICAL_TSCONFIG = 'ERR_FLEET_TSC_CANONICAL_TSCONFIG'

// The canonical check surface named in the block message. The path is data
// for the prescription, not a filesystem probe — the decision stays pure.
export const CANONICAL_CHECK_TSCONFIG = '.config/fleet/tsconfig.check.json'

/**
 * A tsc-tsconfig-guard verdict. `blocked: false` allows; a block carries a
 * human `reason` label for the invocation it fired on.
 */
export interface TscTsconfigGuardDecision {
  readonly blocked: boolean
  readonly reason?: string | undefined
}

const ALLOW: TscTsconfigGuardDecision = { blocked: false }

/**
 * Extract the `-p`/`--project` value from a tsc arg list, handling both the
 * split form `-p path` and the joined forms `-p=path` / `--project=path`.
 * Returns undefined when no project flag is present.
 */
export function projectArgValue(args: readonly string[]): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === '--project' || arg === '-p') {
      return args[i + 1]
    }
    if (arg.startsWith('-p=') || arg.startsWith('--project=')) {
      return arg.slice(arg.indexOf('=') + 1)
    }
  }
  return undefined
}

// True when a project path lives under a `.config/` directory — the home of
// every canonical fleet config, including the check tsconfig.
function isConfigRootedProject(project: string): boolean {
  const normalized = normalizePath(project)
  return normalized.startsWith('.config/') || normalized.includes('/.config/')
}

/**
 * Decide whether a Bash `command` must be blocked as a type-check through a
 * non-canonical tsconfig. Pure — no filesystem, no environment. Evaluates
 * every tsc / node / pnpm segment of a chained command.
 *
 * BLOCKS `tsc --noEmit` with no `-p`, or with a `-p` outside `.config/`.
 * ALLOWS a `.config/`-rooted project file, tsc without `--noEmit`, and every
 * non-tsc command — those match no rule.
 */
export function decideTscTsconfigGuard(
  command: string,
): TscTsconfigGuardDecision {
  const argLists: Array<readonly string[]> = []
  for (const cmd of commandsFor(command, 'tsc')) {
    argLists.push(cmd.args)
  }
  for (const cmd of commandsFor(command, 'node')) {
    const first = cmd.args[0]
    if (first && normalizePath(first).endsWith('typescript/bin/tsc')) {
      argLists.push(cmd.args.slice(1))
    }
  }
  for (const cmd of commandsFor(command, 'pnpm')) {
    if (cmd.args[0] === 'exec' && cmd.args[1] === 'tsc') {
      argLists.push(cmd.args.slice(2))
    }
  }
  for (let i = 0, { length } = argLists; i < length; i += 1) {
    const args = argLists[i]!
    if (!args.includes('--noEmit')) {
      continue
    }
    const project = projectArgValue(args)
    if (project === undefined) {
      return { blocked: true, reason: 'tsc --noEmit with no -p/--project' }
    }
    if (!isConfigRootedProject(project)) {
      return { blocked: true, reason: `tsc --noEmit -p ${project}` }
    }
  }
  return ALLOW
}

/**
 * True when the environment looks like CI, where the checks run through their
 * own workflow rather than an interactive agent.
 */
export function isCiEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env['CI'] || env['GITHUB_ACTIONS'] || env['CONTINUOUS_INTEGRATION'],
  )
}

export function formatBlock(decision: TscTsconfigGuardDecision): string {
  const reason =
    decision.reason ?? 'a type-check through a non-canonical tsconfig'
  return (
    [
      `[tsc-canonical-tsconfig-guard] Blocked: ${reason} — type-check through the canonical check config. [${ERR_TSC_CANONICAL_TSCONFIG}]`,
      '',
      `  What:  ${reason}. The repo-root tsconfig.json is a base/editor config;`,
      '         the check surface is the fleet check tsconfig, which enables',
      '         allowImportingTsExtensions for `.mts`-extension imports. A raw',
      '         run yields a wall of TS5097 noise that reads as real breakage',
      '         and sends the session chasing phantom errors.',
      `  Saw:   ${reason}.`,
      '  Fix:   run the type check the way the gate does:',
      `           node node_modules/typescript/bin/tsc --noEmit -p ${CANONICAL_CHECK_TSCONFIG}`,
      '         or run the whole gate, which includes it:',
      '           pnpm run check',
    ].join('\n') + '\n'
  )
}

export const check = bashGuard(command => {
  // CI runs the checks through its own workflow — no interactive agent to gate.
  if (isCiEnv(process.env)) {
    return undefined
  }
  const decision = decideTscTsconfigGuard(command)
  if (!decision.blocked) {
    return undefined
  }
  return block(formatBlock(decision))
})

export const hook = defineHook({
  bypass: ['tsc-raw-tsconfig'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
