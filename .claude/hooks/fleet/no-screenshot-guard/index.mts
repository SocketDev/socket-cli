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

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { findInvocation } from '../_shared/shell-command.mts'

// Pre-flight triggers — the dispatcher imports + runs this guard only when the
// raw payload contains at least one of these substrings. The guard blocks ONLY
// when `screenshotBinaryIn` matches a SCREENSHOT_BINARIES entry, and that match
// requires the binary name to appear verbatim in the command (findInvocation's
// own substring gate). So the binary-name set IS the complete, safe trigger set:
// no blocking command can omit all of them. Keep in lock-step with
// SCREENSHOT_BINARIES below (case-sensitive — SnippingTool.exe ⊄ snippingtool).
export const triggers: readonly string[] = [
  'SnippingTool.exe',
  'flameshot',
  'gnome-screenshot',
  'grim',
  'import',
  'maim',
  'screencapture',
  'scrot',
  'snippingtool',
  'spectacle',
]

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

export const check = bashGuard(command => {
  const binary = screenshotBinaryIn(command)
  if (!binary) {
    return undefined
  }
  return block(
    [
      '[no-screenshot-guard] Blocked: screen capture',
      '',
      `  Command invokes the screen-capture tool \`${binary}\`.`,
      '',
      '  A screenshot can capture any window on the display (a password',
      '  manager, a 2FA code, another app) and write it to a file — an',
      '  exfiltration surface. Fleet tooling renders known pages to PNG via',
      '  the rendering-chromium-to-png skill; it never captures the desktop.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['screenshot'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
