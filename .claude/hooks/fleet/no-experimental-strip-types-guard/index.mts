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

import { parseCommands } from '../_shared/shell-command.mts'

interface ToolInput {
  readonly tool_input?: { readonly command?: string | undefined } | undefined
  readonly tool_name?: string | undefined
}

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

let payloadRaw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  payloadRaw += chunk
})
process.stdin.on('end', () => {
  // Fail OPEN on any internal bug. The JSON.parse below already has
  // its own try/catch (bad payloads exit 0), but unexpected throws in
  // the regex/stderr path would otherwise become unhandled rejections
  // → exit 1 → block. Per CLAUDE.md, hooks must not brick the session
  // on their own crash.
  try {
    let payload: ToolInput
    try {
      payload = JSON.parse(payloadRaw) as ToolInput
    } catch {
      // Fail open on malformed payload.
      process.exit(0)
    }

    if (payload.tool_name !== 'Bash') {
      process.exit(0)
    }
    const command = payload.tool_input?.command ?? ''

    // Fire only when the flag is a real argument to a parsed command, or
    // lives in a NODE_OPTIONS env assignment — never on a quoted mention
    // inside an `echo`/`-m` message body.
    if (!passesStripTypesFlag(command)) {
      process.exit(0)
    }

    process.stderr.write(
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
    process.exit(2)
  } catch (e) {
    process.stderr.write(
      `[no-experimental-strip-types-guard] hook error (allowing): ${e}\n`,
    )
    process.exit(0)
  }
})
