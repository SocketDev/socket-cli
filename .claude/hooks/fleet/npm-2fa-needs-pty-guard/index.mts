#!/usr/bin/env node
// Claude Code PreToolUse hook — npm-2fa-needs-pty-guard.
//
// BLOCKS a raw `npm publish|login|deprecate|owner|access` invocation run from a
// likely-interactive, non-CI agent shell, and routes it to the fleet PTY
// wrapper `node scripts/fleet/npm-web-auth.mts <op>`.
//
// WHY. These npm operations require 2FA. On a real terminal npm runs a browser
// web-auth flow. Under an agent that flow breaks two ways: the Bash channel is
// NOT a TTY, so npm errors `EOTP` instead of opening the browser and polling;
// and the agent harness MASKS the auth URL in displayed output as
// `auth/cli/***`, so it can't be relayed by reading what the terminal shows.
// The wrapper fixes both — it runs npm under a `script` PTY so npm performs its
// native open-and-poll flow, and reads the auth URL off the RAW process stream
// to auto-open it, sidestepping the masking. See docs/agents.md/fleet/
// npm-2fa-web-auth.md.
//
// Detection is AST-parsed via commandsFor, not a raw regex, so a quoted "npm
// publish" in a message or a sibling command can't false-fire.
//
// Does NOT fire when:
//   - `--otp=<code>` is already supplied — no browser is needed, and
//     no-npm-otp-flag-guard separately owns the OTP-leak concern.
//   - the command already invokes the wrapper, i.e. it mentions `npm-web-auth`.
//   - the context is CI, with CI / GITHUB_ACTIONS / CONTINUOUS_INTEGRATION set —
//     CI authenticates with a token via NODE_AUTH_TOKEN, no browser.
//   - the acted-on repo is not fleet-managed — the wrapper is a fleet script.
//
// STAGED-RELEASE DOCTRINE. Fleet releases of a scoped @socketsecurity/* package
// go through the STAGED web-UI flow, never a local `npm publish`. When the
// blocked op is a publish of such a package the message says so, instead of
// pointing at the PTY wrapper. The wrapper is for the interactive-auth mechanic
// of login/deprecate/owner/access and non-fleet or placeholder publishes.
//
// Bypass: `Allow npm-2fa-pty bypass` typed verbatim in a recent user turn.
//
// Fails open on parse / payload errors — a guard bug must not wedge every Bash
// call.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { NPM_VALUE_FLAGS, positionalArgs } from '../_shared/positional-args.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor, commandWorkingDir } from '../_shared/shell-command.mts'

// The npm auth operations whose write path triggers the 2FA web-auth flow.
const AUTH_OPERATIONS: readonly string[] = [
  'access',
  'deprecate',
  'login',
  'owner',
  'publish',
]

// Pre-flight skip hint: detection only fires when the `npm` binary is invoked.
export const triggers: readonly string[] = ['npm']

export interface NpmAuthDetection {
  readonly detected: boolean
  // The auth operation seen (publish / login / …), for the message. Empty when
  // nothing was detected.
  readonly operation: string
}

// True when `arg` is an `--otp` flag in either form (`--otp` / `--otp=<code>`).
function isOtpFlag(arg: string): boolean {
  return arg === '--otp' || arg.startsWith('--otp=')
}

/**
 * Detect a bare `npm <auth-op>` invocation that needs the PTY web-auth wrapper.
 * Returns `detected: false` when no npm auth op is present, when an `--otp`
 * flag is already supplied, or when the command already invokes the wrapper.
 */
export function detectNpmAuth(command: string): NpmAuthDetection {
  // Already routed through the wrapper — nothing to do.
  if (command.includes('npm-web-auth')) {
    return { detected: false, operation: '' }
  }
  for (const { args } of commandsFor(command, 'npm')) {
    if (args.some(isOtpFlag)) {
      // OTP supplied: no browser needed. no-npm-otp-flag-guard owns this case.
      continue
    }
    // The operation is the first POSITIONAL token — not merely the first
    // non-flag one. `npm --otp 123456 publish` returns the OTP under the
    // naive form, so this guard missed the very 2FA invocation it exists
    // for. Shared parse skips a value flag and the token it consumes.
    const op = positionalArgs(args, NPM_VALUE_FLAGS, 1)[0]
    if (op && (AUTH_OPERATIONS as readonly string[]).includes(op)) {
      return { detected: true, operation: op }
    }
  }
  return { detected: false, operation: '' }
}

// True when the environment looks like CI, where npm authenticates with a token
// via NODE_AUTH_TOKEN and never needs a browser.
export function isCiEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env['CI'] || env['GITHUB_ACTIONS'] || env['CONTINUOUS_INTEGRATION'],
  )
}

// The scoped @socketsecurity/* package name of the acted-on repo, or undefined.
// A publish of such a package must go through the staged web-UI flow, not a
// local publish — so the message changes shape. Fail-open to undefined.
function scopedFleetPackageName(command: string): string | undefined {
  try {
    const pkgPath = path.join(commandWorkingDir(command), 'package.json')
    if (!existsSync(pkgPath)) {
      return undefined
    }
    const name = JSON.parse(readFileSync(pkgPath, 'utf8'))?.name
    return typeof name === 'string' && name.startsWith('@socketsecurity/')
      ? name
      : undefined
  } catch {
    return undefined
  }
}

export function formatBlock(
  d: NpmAuthDetection,
  scopedPkg: string | undefined,
): string {
  if (d.operation === 'publish' && scopedPkg) {
    return `🚨 npm-2fa-needs-pty-guard: blocked "npm publish" — ${scopedPkg} releases via the STAGED web-UI flow (stage in the pipeline, promote on npmjs.com), never a local publish; see docs/agents.md/fleet/npm-2fa-web-auth.md\n`
  }
  return `🚨 npm-2fa-needs-pty-guard: blocked "npm ${d.operation}" (2FA needs a browser; this channel has no TTY, so npm errors EOTP) — run \`node scripts/fleet/npm-web-auth.mts ${d.operation} <args...>\`\n`
}

export const check = bashGuard(command => {
  const detection = detectNpmAuth(command)
  if (!detection.detected) {
    return undefined
  }
  // CI authenticates with a token, never a browser — leave it alone.
  if (isCiEnv(process.env)) {
    return undefined
  }
  return block(formatBlock(detection, scopedFleetPackageName(command)))
})

export const hook = defineHook({
  bypass: ['npm-2fa-pty'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
