#!/usr/bin/env node
// Claude Code PreToolUse hook — no-clipboard-access-guard.
//
// Blocks a script / hook / Bash command from reading or writing the system
// clipboard. The clipboard is a cross-process exfil + overwrite surface: a
// secret copied there leaks to any app, and an OSC-52 escape written to the
// terminal can silently overwrite (or, on permissive terminals, read) it. The
// fleet's own tooling never needs clipboard access, so any attempt is either a
// mistake or a poisoning fingerprint.
//
// Two surfaces, gated on tool_name (the payload is read once; stdin can't be
// consumed twice, so this doesn't compose the withBashGuard/withEditGuard
// harnesses — it reads the raw payload and branches):
//
//   1. Bash — a clipboard CLI in the command line. AST-parsed via the
//      fleet shell parser (findInvocation), not a loose regex, so a path
//      fragment like `pbcopyrc` or a quoted literal doesn't false-fire:
//        macOS:   pbcopy, pbpaste
//        Linux:   xclip, xsel, wl-copy, wl-paste
//        Windows: clip, clip.exe
//
//   2. Edit / Write — source that emits an OSC-52 clipboard escape
//      (`ESC ] 52 ; ...`) in any of its literal spellings (\x1b / \033 /
//       / the raw control byte). That's the sequence the earlier
//      Terminal "attempted to access the clipboard" denial came from.
//
// Bypass: `Allow clipboard-access bypass` in a recent user turn — for a
// genuine, operator-driven clipboard need (rare).
//
// Exit codes: 0 — pass; 2 — block. Fails open on a malformed payload
// (exit 0 + stderr log), the fleet's hook contract.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findInvocation } from '../_shared/shell-command.mts'
import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow clipboard-access bypass'

// Clipboard CLIs, by platform, with the label surfaced in the error.
const CLIPBOARD_BINARIES: ReadonlyArray<{
  readonly binary: string
  readonly platform: string
}> = [
  { binary: 'clip', platform: 'Windows' },
  { binary: 'clip.exe', platform: 'Windows' },
  { binary: 'pbcopy', platform: 'macOS' },
  { binary: 'pbpaste', platform: 'macOS' },
  { binary: 'wl-copy', platform: 'Linux' },
  { binary: 'wl-paste', platform: 'Linux' },
  { binary: 'xclip', platform: 'Linux' },
  { binary: 'xsel', platform: 'Linux' },
]

// OSC-52 clipboard escape in any literal spelling a source file might carry:
// the raw ESC byte, or an escaped \x1b / \033 / , immediately followed
// by `]52;`. Matching the prefix is enough — the payload after `52;` is the
// clipboard data and need not be parsed.
const OSC52_RE = /(?:\x1b|\\x1b|\\u001b|\\033|\\e)\]52;/i

export interface PayloadShape {
  tool_name?: string | undefined
  tool_input?:
    | {
        command?: string | undefined
        content?: string | undefined
        new_string?: string | undefined
      }
    | undefined
  transcript_path?: string | undefined
}

// The clipboard CLI invoked in a Bash command line, or undefined when none.
export function clipboardBinaryIn(command: string): string | undefined {
  for (let i = 0, { length } = CLIPBOARD_BINARIES; i < length; i += 1) {
    const entry = CLIPBOARD_BINARIES[i]!
    if (findInvocation(command, { binary: entry.binary })) {
      return entry.binary
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
export function clipboardViolation(payload: PayloadShape): string | undefined {
  const toolName = payload.tool_name
  const input = payload.tool_input
  if (!input) {
    return undefined
  }
  if (toolName === 'Bash') {
    const command = input.command
    if (typeof command === 'string') {
      const binary = clipboardBinaryIn(command)
      if (binary) {
        return `Bash command invokes the clipboard tool \`${binary}\``
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

async function main(): Promise<void> {
  let payload: PayloadShape
  try {
    payload = JSON.parse(await readStdin()) as PayloadShape
  } catch {
    // Malformed payload: fail open.
    return
  }
  const reason = clipboardViolation(payload)
  if (!reason) {
    return
  }
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return
  }
  logger.error(
    [
      '[no-clipboard-access-guard] Blocked: clipboard access',
      '',
      `  ${reason}.`,
      '',
      '  The system clipboard is a cross-process exfil + overwrite surface;',
      '  fleet tooling never needs it. A secret copied there leaks to every',
      '  app, and an OSC-52 escape can silently overwrite or read it.',
      '',
      `  If you genuinely need clipboard access, type the phrase in a new`,
      `  message: ${BYPASS_PHRASE}`,
    ].join('\n'),
  )
  process.exitCode = 2
}

if (process.argv[1]?.endsWith('index.mts')) {
  // Async IIFE: the await lives inside the function (no top-level await — the
  // CJS bundle target forbids it), and main()'s promise is still awaited
  // rather than floated. main() reads stdin + sets process.exitCode; a throw
  // fails open per the hook contract.
  void (async () => {
    await main()
  })()
}
