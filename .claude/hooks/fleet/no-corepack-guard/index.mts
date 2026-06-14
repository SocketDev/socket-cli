#!/usr/bin/env node
// Claude Code PreToolUse hook — no-corepack-guard.
//
// BLOCKS any Bash command that activates corepack to provision a package
// manager: `corepack enable`, `corepack prepare`, `corepack use`, or
// `corepack install` (with or without a `pnpm@<v>` / `--activate` argument).
//
// Why corepack is verboten fleet-wide: the fleet installs pnpm from a pinned
// version via download + Subresource-Integrity (the `setup-tools.mjs`
// bootstrap locally, the SocketDev/socket-registry `setup` composite action in
// CI) so the exact bytes are integrity-checked before they run. corepack
// instead fetches a package manager from the npm registry at activation time,
// outside that gate, and keys off a mutable `packageManager` field — a second,
// un-pinned provisioning path that bypasses the fleet's supply-chain controls.
// The `packageManager` field stays in package.json as a declared-version
// RECORD (kept in lockstep with external-tools.json); this guard only blocks
// the corepack COMMANDS that would activate it.
//
// Detection (AST-parsed via the shared shell-command helper, not a raw regex):
// the command runs the `corepack` binary with an activating subcommand.
// `corepack --version` / `corepack --help` are allowed (they activate nothing).
//
// Bypass: `Allow corepack bypass` typed verbatim in a recent user turn.
//
// Fails open on parse / payload errors (exit 0) — a guard bug must not wedge
// every Bash call.

import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'
import { commandsFor } from '../_shared/shell-command.mts'

const BYPASS_PHRASE = 'Allow corepack bypass' as const

interface Payload {
  tool_name?: unknown | undefined
  tool_input?: { command?: unknown | undefined } | undefined
  transcript_path?: unknown | undefined
}

// corepack subcommands that fetch + activate a package manager. `enable`
// shims the PMs onto PATH; `prepare`/`use`/`install` download a specific
// version. Anything else (`--version`, `--help`, `disable`) provisions
// nothing and is left alone.
const ACTIVATING_SUBCOMMANDS = ['enable', 'install', 'prepare', 'use'] as const

export interface CorepackDetection {
  readonly detected: boolean
  // The activating subcommand seen (enable / prepare / use / install), for
  // the message. Empty when nothing was detected.
  readonly subcommand: string
}

export function detectCorepack(command: string): CorepackDetection {
  const corepackCmds = commandsFor(command, 'corepack')
  for (const { args } of corepackCmds) {
    // The first non-flag token is the subcommand (`corepack enable`,
    // `corepack prepare pnpm@9`). A leading flag (`corepack --version`)
    // means no activating subcommand.
    for (let i = 0, { length } = args; i < length; i += 1) {
      const arg = args[i]!
      if (arg.startsWith('-')) {
        continue
      }
      if ((ACTIVATING_SUBCOMMANDS as readonly string[]).includes(arg)) {
        return { detected: true, subcommand: arg }
      }
      // First bare token is some other subcommand (e.g. `disable`) — stop.
      break
    }
  }
  return { detected: false, subcommand: '' }
}

export function formatBlock(d: CorepackDetection): string {
  return (
    [
      `[no-corepack-guard] Blocked: \`corepack ${d.subcommand}\` activates a package manager outside the fleet's supply-chain gate.`,
      '',
      '  The fleet pins pnpm in external-tools.json and installs it from that',
      '  exact version via download + SRI-integrity — never corepack:',
      '',
      '    node scripts/fleet/setup/setup-tools.mjs   (local bootstrap)',
      '    # CI runs the same step via the socket-registry `setup` action',
      '',
      '  The package.json `packageManager` field is a declared-version record',
      '  kept in lockstep with external-tools.json; leave it in place, just',
      '  do not invoke corepack to act on it.',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" to allow it for this invocation.`,
    ].join('\n') + '\n'
  )
}

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: Payload
  try {
    payload = JSON.parse(raw) as Payload
  } catch {
    process.exit(0)
  }

  if (payload.tool_name !== 'Bash') {
    process.exit(0)
  }

  const command =
    typeof payload.tool_input?.command === 'string'
      ? payload.tool_input.command
      : ''
  if (!command.trim()) {
    process.exit(0)
  }

  const detection = detectCorepack(command)
  if (!detection.detected) {
    process.exit(0)
  }

  const transcriptPath =
    typeof payload.transcript_path === 'string'
      ? payload.transcript_path
      : undefined
  if (
    transcriptPath &&
    bypassPhrasePresent(transcriptPath, [BYPASS_PHRASE], 3)
  ) {
    process.exit(0)
  }

  process.stderr.write(formatBlock(detection))
  process.exit(2)
}

// Entrypoint-guarded: run main() only when invoked directly, NOT when the test
// imports this module for its pure helpers (else main() blocks on stdin at
// import and the test file never terminates).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
