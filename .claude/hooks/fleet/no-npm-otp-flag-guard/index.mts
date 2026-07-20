#!/usr/bin/env node
// Claude Code PreToolUse hook — no-npm-otp-flag-guard.
//
// Blocks an npm-family command (npm, pnpm, yarn) that passes the 2FA one-time
// code as a flag (`--otp=<code>` or `--otp <code>`).
//
// Passing the OTP on the command line leaks the one-time code into the shell
// history, the process list (`ps`), and CI logs — every place token-hygiene
// says a secret must never appear. It is also a worse UX than the browser
// flow: npm's `--auth-type=web` opens the browser to approve 2FA, and CI uses
// a granular automation token via `NODE_AUTH_TOKEN`. There is no good reason
// to ever pass `--otp` as a flag.
//
// `--otp` is unambiguously an npm-family auth flag, so its presence on an
// npm-family invocation IS an auth command leaking the code. The guard is
// deliberately narrow: it blocks ONLY when `--otp` rides one of those
// binaries. Plain `npm install`, `npm run`, `npm ci`, `npm test` — or any
// command without `--otp` — passes untouched.
//
// Bypass: `Allow npm-otp-flag bypass` in a recent user turn (rare — there is
// effectively no legitimate need to leak the OTP into a flag).

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// npm-family binaries whose auth subcommands (publish, login, access,
// dist-tag, unpublish, deprecate, owner) accept `--otp`.
const NPM_BINARIES: readonly string[] = ['npm', 'pnpm', 'yarn']

// Pre-flight skip set: the dispatcher only imports this guard when the raw
// payload contains `--otp`. That single substring gates every block path — the
// guard does nothing without it, so over-triggering is impossible here.
export const triggers: readonly string[] = ['--otp']

// True when `arg` is an `--otp` flag in either form:
//   --otp=<code>   (value attached)
//   --otp          (value in the next arg)
function isOtpFlag(arg: string): boolean {
  return arg === '--otp' || arg.startsWith('--otp=')
}

// The npm-family binary leaking the OTP as a flag, or undefined when none.
// Parses with the fleet shell tokenizer (commandsFor) so a quoted `--otp` in a
// commit message, a sibling command, or a path fragment can't false-fire — the
// flag only counts when it rides an npm-family invocation's own args.
export function otpFlagBinaryIn(command: string): string | undefined {
  for (let i = 0, { length } = NPM_BINARIES; i < length; i += 1) {
    const binary = NPM_BINARIES[i]!
    for (const cmd of commandsFor(command, binary)) {
      if (cmd.args.some(isOtpFlag)) {
        return binary
      }
    }
  }
  return undefined
}

// Decide what (if anything) to block for a payload. Returns the offending
// binary, or undefined to pass. Pure — the test drives it directly.
export function otpFlagViolation(payload: ToolCallPayload): string | undefined {
  if (payload.tool_name !== 'Bash') {
    return undefined
  }
  const command = payload.tool_input?.command
  if (typeof command !== 'string') {
    return undefined
  }
  return otpFlagBinaryIn(command)
}

export function check(payload: ToolCallPayload): GuardResult {
  const binary = otpFlagViolation(payload)
  if (!binary) {
    return undefined
  }
  return block(
    [
      '[no-npm-otp-flag-guard] Blocked: OTP passed as a command flag.',
      '',
      `  What:  \`${binary}\` was given the 2FA one-time code via \`--otp\`.`,
      '  Where: the command line — which is recorded in shell history, the',
      '         process list (ps), and CI logs. A one-time code in any of',
      '         those is a leaked secret (token-hygiene).',
      '',
      '  Fix:   use BROWSER auth instead — re-run with `--auth-type=web`',
      '         (npm opens the browser to approve 2FA; no code on the CLI).',
      '         For CI, authenticate with a granular automation token via',
      '         the NODE_AUTH_TOKEN env var — never `--otp`.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['npm-otp-flag'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
