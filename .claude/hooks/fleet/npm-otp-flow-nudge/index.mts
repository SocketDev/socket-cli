#!/usr/bin/env node
// Claude Code PreToolUse hook — npm-otp-flow-nudge.
//
// npm's account-mutating registry operations require 2FA: `npm deprecate`,
// `publish`, `access`, `owner`, `unpublish`, `dist-tag`. npm's PREFERRED
// one-time-password flow opens a browser and waits on an interactive TTY
// prompt ("Authenticate your account at: <url> / Press any key…"). The
// `!`-prefixed Bash channel (and any headless driver) is NOT a TTY, so that
// prompt is swallowed and the command dies with `npm error code EOTP`
// without ever opening the browser.
//
// Observed 2026-06-05: `! npm deprecate socket-mcp "..."` looped on EOTP —
// the interactive "open a browser" step never fired through the `!` channel.
//
// The fix the assistant should surface to the user:
//   1. PREFERRED — run it in a real terminal (Terminal.app / iTerm / a
//      genuine TTY) so npm's browser auth flow works as designed.
//   2. FALLBACK (no TTY available) — pass the code inline:
//        npm deprecate <pkg> "<msg>" --otp=<6-digit-code>
//
// Stderr reminder; never blocks (exit 0). Skips when `--otp=` is already
// present (the caller chose the fallback deliberately).
//

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// npm subcommands that mutate the account/registry and therefore trigger
// the 2FA one-time-password challenge.
const OTP_SUBCOMMANDS = new Set([
  'access',
  'deprecate',
  'dist-tag',
  'owner',
  'publish',
  'unpublish',
])

export const check = bashGuard(command => {
  // AST parse (per no-command-regex-in-hooks): inspect every real `npm`
  // invocation in the command (sees through chains / quotes / `$(…)`).
  const npmCalls = commandsFor(command, 'npm')
  if (!npmCalls.length) {
    return undefined
  }
  const triggered = npmCalls.some(c => {
    const sub = c.args[0]
    if (!sub || !OTP_SUBCOMMANDS.has(sub)) {
      return false
    }
    // Already supplying the OTP inline — caller chose the fallback path.
    return !c.args.some(a => a === '--otp' || a.startsWith('--otp='))
  })
  if (!triggered) {
    return undefined
  }
  return notify(
    [
      '[npm-otp-flow-nudge] This npm op needs a 2FA one-time password.',
      '',
      "  npm's PREFERRED flow opens a browser and waits on an interactive TTY",
      '  prompt. The `!` / headless channel is not a TTY, so that prompt is',
      '  swallowed and the command dies with `EOTP` without opening the browser.',
      '',
      '  Preferred — run it in a REAL terminal so the browser auth works:',
      '      npm deprecate <pkg> "<msg>"',
      '',
      '  Fallback (only when no TTY is available) — pass the code inline:',
      '      npm deprecate <pkg> "<msg>" --otp=<6-digit-code>',
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
