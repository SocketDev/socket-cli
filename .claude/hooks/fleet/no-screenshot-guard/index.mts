#!/usr/bin/env node
// Claude Code PreToolUse hook — no-screenshot-guard.
//
// Blocks a Bash command from capturing the screen. A screenshot is an
// exfiltration surface: it can capture another app's window, a password
// manager, a 2FA code, or anything else on the user's display, and write it to
// a file the agent then reads. Fleet tooling never needs to screenshot the
// user's screen; the visual-verify flow renders a known page/extension to PNG
// via the rendering-chromium-to-png skill (headless Chromium), it does NOT
// capture the live desktop. Any screen-capture invocation is therefore a
// mistake or a poisoning fingerprint.
//
// Detected (AST-parsed via the fleet shell parser — findInvocation — not a
// loose regex, so a path fragment or quoted literal doesn't false-fire):
//
//   macOS:   screencapture
//   Linux:   scrot, grim, import (ImageMagick), gnome-screenshot, spectacle,
//            maim, flameshot
//   Windows: snippingtool, SnippingTool.exe
//
// Bypass: `Allow screenshot bypass` in a recent user turn — for a genuine,
// user-authorized capture (rare; the user explicitly asked for a screenshot).
//
// Exit codes: 0 — pass; 2 — block. Fails open on a malformed payload
// (exit 0 + stderr log), the fleet's hook contract.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withBashGuard } from '../_shared/payload.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow screenshot bypass'

// Screen-capture binaries, by platform.
const SCREENSHOT_BINARIES: ReadonlyArray<{
  readonly binary: string
  readonly platform: string
}> = [
  { binary: 'flameshot', platform: 'Linux' },
  { binary: 'gnome-screenshot', platform: 'Linux' },
  { binary: 'grim', platform: 'Linux' },
  { binary: 'import', platform: 'Linux (ImageMagick)' },
  { binary: 'maim', platform: 'Linux' },
  { binary: 'screencapture', platform: 'macOS' },
  { binary: 'scrot', platform: 'Linux' },
  { binary: 'snippingtool', platform: 'Windows' },
  { binary: 'SnippingTool.exe', platform: 'Windows' },
  { binary: 'spectacle', platform: 'Linux' },
]

// The screen-capture binary invoked in a command line, or undefined when none.
export function screenshotBinaryIn(command: string): string | undefined {
  for (let i = 0, { length } = SCREENSHOT_BINARIES; i < length; i += 1) {
    const entry = SCREENSHOT_BINARIES[i]!
    if (findInvocation(command, { binary: entry.binary })) {
      return entry.binary
    }
  }
  return undefined
}

function checkCommand(command: string, payload: { transcript_path?: string | undefined }): void {
  const binary = screenshotBinaryIn(command)
  if (!binary) {
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
      '[no-screenshot-guard] Blocked: screen capture',
      '',
      `  Command invokes the screen-capture tool \`${binary}\`.`,
      '',
      '  A screenshot can capture any window on the display (a password',
      '  manager, a 2FA code, another app) and write it to a file — an',
      '  exfiltration surface. Fleet tooling renders known pages to PNG via',
      '  the rendering-chromium-to-png skill; it never captures the desktop.',
      '',
      `  If the user explicitly asked for a screenshot, type the phrase in a`,
      `  new message: ${BYPASS_PHRASE}`,
    ].join('\n'),
  )
  process.exitCode = 2
}

if (process.argv[1]?.endsWith('index.mts')) {
  // Async IIFE: await inside the function (no top-level await — CJS bundle
  // target), promise still awaited. withBashGuard drains stdin, gates on the
  // Bash tool, narrows the command, and fails open on any throw.
  void (async () => {
    await withBashGuard(checkCommand)
  })()
}
