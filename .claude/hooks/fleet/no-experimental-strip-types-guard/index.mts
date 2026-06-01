#!/usr/bin/env node
// Claude Code PreToolUse hook — no-experimental-strip-types-guard.
//
// Blocks Bash commands that pass `--experimental-strip-types` to Node.
// The flag became unnecessary in Node 22.6 (when --experimental-strip-types
// went stable) and is a no-op since Node 24+, which strips TS types by
// default. The fleet runs Node 26+; passing the flag is dead weight and
// usually signals stale copy-pasted invocations.
//
// On block, emits stderr identifying the current Node version so the
// reader can see why the flag isn't needed here.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     ... }
//
// Exit codes:
//   0 — pass (not a Bash tool, or command doesn't pass the flag).
//   2 — block (command passes --experimental-strip-types).
//
// Fails open on malformed payloads (exit 0 + stderr log).

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withBashGuard } from '../_shared/payload.mts'
import { parseCommands } from '../_shared/shell-command.mts'

const logger = getDefaultLogger()

const FLAG = '--experimental-strip-types'

// True when any parsed command passes `--experimental-strip-types` as a
// real argument, or carries it inside a `NODE_OPTIONS=…` env assignment
// (Node parses that value as args at startup, so it's live even when the
// assignment value is quoted). The parser scopes the flag to an actual
// invocation, so a quoted mention inside an `echo`/`-m` body is ignored.
function passesStripTypesFlag(command: string): boolean {
  for (const c of parseCommands(command)) {
    if (c.args.some(a => a === FLAG || a.startsWith(`${FLAG}=`))) {
      return true
    }
    for (const a of c.assignments) {
      if (a.startsWith('NODE_OPTIONS=') && a.includes(FLAG)) {
        return true
      }
    }
  }
  return false
}

// Fire only when the flag is a real argument to a parsed command, or lives
// in a NODE_OPTIONS env assignment — never on a quoted mention inside an
// `echo`/`-m` message body. withBashGuard handles the stdin drain, tool_name
// gate, command narrow, and fail-open on any throw.
await withBashGuard(command => {
  if (!passesStripTypesFlag(command)) {
    return
  }
  logger.error(
    [
      '[no-experimental-strip-types-guard] Blocked: --experimental-strip-types',
      '',
      `  Current Node: ${process.version}`,
      '  The fleet runs Node 22.6+ / 24+ / 26+, where TypeScript type stripping',
      '  is either stable (no flag needed) or default-on. Passing the flag is',
      '  a no-op and usually signals a stale copy-pasted invocation.',
      '',
      '  Fix: remove `--experimental-strip-types` from the command.',
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
