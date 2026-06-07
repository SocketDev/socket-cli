#!/usr/bin/env node
// Claude Code PreToolUse hook — claude-lockdown-guard.
//
// Blocks a Bash command that invokes the `claude` CLI or `codex` in a
// programmatic / headless way WITHOUT the required lockdown flags. The
// fleet rule (CLAUDE.md "Programmatic Claude calls",
// .claude/skills/fleet/locking-down-claude/SKILL.md):
// workflows / skills / scripts that run Claude or Codex non-interactively
// must pin down tools + permissions so a headless agent can't be steered
// into a destructive or over-permissioned action. Never `default` mode in
// headless contexts; never `bypassPermissions`; never a full-access
// sandbox.
//
// What "programmatic / headless" means here (conservative — only fire on
// clear non-interactive invocations):
//   - `claude` with `-p` / `--print` (headless print mode).
//   - `codex exec` (the non-interactive Codex entry point).
// An interactive `claude` (no -p/--print) or a bare `codex` (no `exec`)
// is fine and passes.
//
// For a headless `claude` we REQUIRE all of:
//   - `--allowedTools` (or `--allowed-tools`)
//   - `--disallowedTools` (or `--disallowed-tools`)
//   - `--permission-mode <mode>` where mode is NOT `default` and NOT
//     `bypassPermissions` (e.g. dontAsk / acceptEdits / plan)
// and we BLOCK `--dangerously-skip-permissions` outright.
//
// For a headless `codex exec` we BLOCK the obvious escape hatches:
//   - `--dangerously-bypass-approvals-and-sandbox`
//   - `--sandbox danger-full-access`
// and otherwise require a `--sandbox` and an approval policy
// (`--ask-for-approval` / `-a`) to be present.
//
// Fails open on anything ambiguous (a guard must never wedge a command it
// can't reason about).
//
// Exit codes: 0 pass, 2 block.
//
// Bypass: `Allow programmatic-claude-lockdown bypass` in a recent user
// turn.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withBashGuard } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow programmatic-claude-lockdown bypass'

const ALLOWED_TOOLS_FLAGS = new Set(['--allowed-tools', '--allowedTools'])
const DISALLOWED_TOOLS_FLAGS = new Set([
  '--disallowed-tools',
  '--disallowedTools',
])
const PERMISSION_MODE_FLAG = '--permission-mode'
const SKIP_PERMISSIONS_FLAG = '--dangerously-skip-permissions'
const PRINT_FLAGS = new Set(['-p', '--print'])
const BAD_PERMISSION_MODES = new Set(['bypassPermissions', 'default'])

const CODEX_BYPASS_FLAG = '--dangerously-bypass-approvals-and-sandbox'
const SANDBOX_FLAG = '--sandbox'
const ASK_FOR_APPROVAL_FLAGS = new Set(['--ask-for-approval', '-a'])
const DANGER_FULL_ACCESS = 'danger-full-access'

// Read the value of a flag whether written `--flag value` or
// `--flag=value`. Returns undefined when the flag is absent or has no
// resolvable value.
export function flagValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === flag) {
      const next = args[i + 1]
      return next !== undefined && !next.startsWith('-') ? next : undefined
    }
    const prefix = `${flag}=`
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length)
    }
  }
  return undefined
}

function hasAnyFlag(
  args: readonly string[],
  flags: ReadonlySet<string>,
): boolean {
  return args.some(a => {
    if (flags.has(a)) {
      return true
    }
    const eq = a.indexOf('=')
    return eq > 0 && flags.has(a.slice(0, eq))
  })
}

// Inspect every headless `claude` invocation; return a block reason or
// undefined when all headless calls are locked down (or there are none).
export function claudeLockdownReason(command: string): string | undefined {
  for (const cmd of commandsFor(command, 'claude')) {
    const { args } = cmd
    const isHeadless = args.some(a => PRINT_FLAGS.has(a))
    if (!isHeadless) {
      continue
    }
    if (args.includes(SKIP_PERMISSIONS_FLAG)) {
      return `headless \`claude\` uses ${SKIP_PERMISSIONS_FLAG}`
    }
    if (!hasAnyFlag(args, ALLOWED_TOOLS_FLAGS)) {
      return 'headless `claude` is missing --allowedTools'
    }
    if (!hasAnyFlag(args, DISALLOWED_TOOLS_FLAGS)) {
      return 'headless `claude` is missing --disallowedTools'
    }
    const mode = flagValue(args, PERMISSION_MODE_FLAG)
    if (mode === undefined) {
      return 'headless `claude` is missing --permission-mode'
    }
    if (BAD_PERMISSION_MODES.has(mode)) {
      return `headless \`claude\` uses --permission-mode ${mode}`
    }
  }
  return undefined
}

// Inspect every `codex exec` invocation; return a block reason or
// undefined when all are acceptably sandboxed.
export function codexLockdownReason(command: string): string | undefined {
  for (const cmd of commandsFor(command, 'codex')) {
    const { args } = cmd
    if (args[0] !== 'exec') {
      continue
    }
    if (args.includes(CODEX_BYPASS_FLAG)) {
      return `\`codex exec\` uses ${CODEX_BYPASS_FLAG}`
    }
    if (flagValue(args, SANDBOX_FLAG) === DANGER_FULL_ACCESS) {
      return `\`codex exec\` uses --sandbox ${DANGER_FULL_ACCESS}`
    }
    if (!hasAnyFlag(args, new Set([SANDBOX_FLAG]))) {
      return '`codex exec` is missing --sandbox'
    }
    if (!hasAnyFlag(args, ASK_FOR_APPROVAL_FLAGS)) {
      return '`codex exec` is missing --ask-for-approval'
    }
  }
  return undefined
}

export function lockdownReason(command: string): string | undefined {
  return claudeLockdownReason(command) ?? codexLockdownReason(command)
}

await withBashGuard((command, payload) => {
  const reason = lockdownReason(command)
  if (!reason) {
    return
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return
  }
  logger.error(
    [
      `[claude-lockdown-guard] Blocked: ${reason}.`,
      '',
      '  A programmatic / headless Claude or Codex invocation must pin down',
      '  tools and permissions. For `claude -p`, set all of --allowedTools,',
      '  --disallowedTools, and --permission-mode (dontAsk / acceptEdits /',
      '  plan — never default or bypassPermissions), and never pass',
      '  --dangerously-skip-permissions. For `codex exec`, set --sandbox',
      '  (never danger-full-access) and --ask-for-approval, and never pass',
      '  --dangerously-bypass-approvals-and-sandbox. See',
      '  .claude/skills/fleet/locking-down-claude/SKILL.md.',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a recent message.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
