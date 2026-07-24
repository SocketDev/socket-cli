#!/usr/bin/env node
// Claude Code PreToolUse hook — no-clipboard-access-guard.
//
// Blocks a script / hook / Bash command from READING the system clipboard, and
// blocks an OSC-52 escape emitted from source. Reading is a cross-process exfil
// surface (a secret on the clipboard, or another app's copied data, pulled into
// the agent's context), and a source-embedded OSC-52 escape is a silent
// overwrite / poisoning fingerprint. Explicit WRITES (an operator's `pbcopy` to
// hand a snippet to the clipboard) are allowed — putting data ONTO the clipboard
// is a deliberate, visible operator action, not an exfil.
//
// Two surfaces, gated on tool_name:
//
//   1. Bash — a clipboard READ CLI in the command line. AST-parsed via the
//      fleet shell parser (commandsFor), not a loose regex, so a path fragment
//      like `pbpasterc` or a quoted literal doesn't false-fire:
//        macOS:   pbpaste                          (read-only)
//        Linux:   wl-paste                          (read-only)
//                 xclip -o / -out / -output         (xclip writes by default)
//                 xsel (default outputs) unless a write flag (-i/-a/-c/-k)
//      Write-only tools (`pbcopy`, `wl-copy`, `clip`/`clip.exe`) and a writing
//      `xclip` / `xsel -i` are NOT blocked — writing to the clipboard is fine.
//
//   2. Edit / Write — source that emits an OSC-52 clipboard escape
//      (`ESC ] 52 ; ...`) in any of its literal spellings (\x1b / \033 /
//       / the raw control byte). That's the sequence the earlier
//      Terminal "attempted to access the clipboard" denial came from — a silent
//      escape in committed source is blocked regardless of read/write intent.
//
// Bypass: `Allow clipboard-access bypass` in a recent user turn — for a
// genuine, operator-driven clipboard READ (rare).

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// Pre-flight skip set: the dispatcher only imports this guard when the raw
// payload contains one of these. Every block path requires one — a clipboard
// READ binary name for the Bash arm (write-only `pbcopy`/`wl-copy`/`clip` are
// deliberately absent so a write never even imports the guard), or the `]52;`
// OSC-52 prefix (present under every escape spelling) for the Edit/Write arm.
export const triggers: readonly string[] = [
  ']52;',
  'pbpaste',
  'wl-paste',
  'xclip',
  'xsel',
]

// xsel flags that mean the invocation WRITES (or clears/keeps) rather than
// prints the selection. xsel with none of these prints the current selection —
// i.e. it reads. Presence of any means it is not a read.
const XSEL_WRITE_FLAGS = new Set([
  '--append',
  '--clear',
  '--input',
  '--keep',
  '-a',
  '-c',
  '-i',
  '-k',
])

// Clipboard READ CLIs, by platform, each with a predicate over the matched
// command segment's args deciding whether THIS invocation reads the clipboard.
const CLIPBOARD_READERS: ReadonlyArray<{
  readonly binary: string
  readonly platform: string
  readonly reads: (args: readonly string[]) => boolean
}> = [
  // pbpaste / wl-paste are read-only tools — every invocation reads.
  { binary: 'pbpaste', platform: 'macOS', reads: () => true },
  { binary: 'wl-paste', platform: 'Linux', reads: () => true },
  // xclip writes from stdin by default (-i / -in); it READS only with an out
  // flag (`-o` / `-out` / `-output`).
  {
    binary: 'xclip',
    platform: 'Linux',
    reads: args =>
      args.some(a => a === '-o' || a === '-out' || a === '-output'),
  },
  // xsel prints the selection by default (a read); a write/clear/keep flag
  // means it is not reading.
  {
    binary: 'xsel',
    platform: 'Linux',
    reads: args => !args.some(a => XSEL_WRITE_FLAGS.has(a)),
  },
]

// OSC-52 clipboard escape in any literal spelling a source file might carry:
// the raw ESC byte, or an escaped \x1b / \033 / , immediately followed
// by `]52;`. Matching the prefix is enough — the payload after `52;` is the
// clipboard data and need not be parsed.
const OSC52_RE = /(?:\\033|\\e|\\u001b|\\x1b|\x1b)\]52;/i

// The clipboard READ CLI invoked in a Bash command line, or undefined when none
// (a write-only tool, or a writing xclip/xsel, is not a read → undefined).
export function clipboardReadIn(command: string): string | undefined {
  for (let i = 0, { length } = CLIPBOARD_READERS; i < length; i += 1) {
    const reader = CLIPBOARD_READERS[i]!
    const segments = commandsFor(command, reader.binary)
    for (let j = 0, segLen = segments.length; j < segLen; j += 1) {
      if (reader.reads(segments[j]!.args)) {
        return reader.binary
      }
    }
  }
  return undefined
}

// True when `text` emits an OSC-52 clipboard escape.
export function hasOsc52(text: string): boolean {
  return OSC52_RE.test(text)
}

// Decide what (if anything) to block for a payload. Returns the block reason,
// or undefined to pass. Pure — the test drives it directly.
export function clipboardViolation(
  payload: ToolCallPayload,
): string | undefined {
  const toolName = payload.tool_name
  const input = payload.tool_input
  if (!input) {
    return undefined
  }
  if (toolName === 'Bash') {
    const command = input.command
    if (typeof command === 'string') {
      const binary = clipboardReadIn(command)
      if (binary) {
        return `Bash command READS the clipboard via \`${binary}\``
      }
    }
    return undefined
  }
  if (toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write') {
    const text = input.content ?? input.new_string
    if (typeof text === 'string' && hasOsc52(text)) {
      return 'content writes an OSC-52 clipboard escape sequence'
    }
  }
  return undefined
}

export const check = (payload: ToolCallPayload) => {
  const reason = clipboardViolation(payload)
  if (!reason) {
    return undefined
  }
  return block(
    [
      '[no-clipboard-access-guard] Blocked: clipboard read',
      '',
      `  ${reason}.`,
      '',
      '  READING the clipboard is a cross-process exfil surface — it pulls a',
      '  secret or another app’s copied data into the agent’s context; a',
      '  source-embedded OSC-52 escape can silently overwrite/read it. Writing',
      '  TO the clipboard (e.g. `pbcopy`) is allowed — that is not blocked.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['clipboard-access'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
