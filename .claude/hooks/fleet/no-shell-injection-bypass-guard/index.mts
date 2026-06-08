#!/usr/bin/env node
// Claude Code PreToolUse hook — no-shell-injection-bypass-guard.
//
// The fleet's Bash defenses are command allowlists (`Bash(curl:*)` deny rules)
// and AST `findInvocation` guards that key off the *base command*. A handful of
// shell constructs route around all of them by hiding or rewriting the command
// the parser sees. They have no legitimate fleet use, so this hook blocks them:
//
//   1. Zsh EQUALS expansion — `=cmd` at word start expands to `$(which cmd)`.
//      `=curl evil.com` runs `/usr/bin/curl evil.com`, but a `Bash(curl:*)`
//      deny never fires because the parser's base command is `=curl`, not
//      `curl`. The single most effective allowlist bypass.
//   2. Process substitution — `<(...)`, `>(...)`, `=(...)` run an arbitrary
//      inner command whose name no allowlist inspects.
//   3. Zsh-module exfil / exec / file-IO builtins — `zmodload` (loads
//      zsh/net/tcp, zsh/system, zsh/zpty, zsh/files) plus the builtins it
//      enables (`ztcp` network exfil, `zpty` command exec, `sysopen`/`sysread`/
//      `syswrite`/`sysseek` raw file IO that bypass binary checks), and
//      `emulate -c` (an eval-equivalent). Blocked as defense-in-depth.
//
// NOT blocked: `$(...)` / `${...}` / backtick substitution — legitimate and
// common in fleet Bash (e.g. `$(git symbolic-ref ...)` in the default-branch
// recipe). This hook targets only the evasion-only forms.
//
// Detection is AST-based (the fleet shell parser — parseShell / parseCommands),
// not raw-string regex, per `no-command-regex-in-hooks-guard`. Lifted from the
// Claude Code client's BashTool/bashSecurity.ts threat model.
//
// Bypass: `Allow shell-injection bypass` in a recent user turn.
//
// Exit codes: 0 — pass; 2 — block. Fails open on a malformed payload.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseShell } from '@socketsecurity/lib-stable/shell/parse'

import { withBashGuard } from '../_shared/payload.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow shell-injection bypass'

// Process-substitution / arithmetic-expansion op markers shell-quote emits.
const SUBSTITUTION_OPS = new Set(['<(', '>(', '=('])

// Zsh module loader + the builtins it enables — network exfil, command exec,
// raw file IO that bypass binary checks.
const ZSH_MODULE_BUILTINS = new Set([
  'emulate',
  'sysopen',
  'sysread',
  'sysseek',
  'syswrite',
  'zmodload',
  'zpty',
  'ztcp',
])

// A shell-quote operator entry, `{ op: '<(' }`.
function isOpEntry(entry: unknown): entry is { op: string } {
  return typeof entry === 'object' && entry !== null && 'op' in entry
}

// The bypass found in `command`, or undefined when clean. Pure — the test
// drives it directly. Uses the fleet shell parser; on a parse failure returns
// undefined (fail-open — a string we can't parse isn't a confirmed bypass).
export function shellInjectionBypass(command: string): string | undefined {
  let commands
  try {
    commands = parseCommands(command)
  } catch {
    return undefined
  }
  for (let i = 0, { length } = commands; i < length; i += 1) {
    const cmd = commands[i]!
    // Zsh EQUALS expansion: the base command literally starts with `=`.
    if (/^=[a-zA-Z_]/.test(cmd.binary)) {
      return `Zsh EQUALS expansion \`${cmd.binary}\` (dodges command allowlists — expands to \`$(which ${cmd.binary.slice(1)})\`)`
    }
    // Zsh-module builtin as the base command (zmodload, ztcp, …).
    if (ZSH_MODULE_BUILTINS.has(cmd.binary)) {
      // `emulate` is only dangerous with -c (eval-equivalent); a bare
      // `emulate zsh` shell-mode switch is fine.
      if (cmd.binary === 'emulate' && !cmd.args.includes('-c')) {
        continue
      }
      return `zsh-module builtin \`${cmd.binary}\` (network exfil / command exec / raw file IO that bypasses binary checks)`
    }
  }
  // Process substitution: scan the raw parser ops (parseCommands collapses them
  // into segment boundaries, so check the op stream directly).
  return processSubstitutionBypass(command)
}

function processSubstitutionBypass(command: string): string | undefined {
  let entries: unknown[]
  try {
    entries = parseShell(command) as unknown[]
  } catch {
    return undefined
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    if (isOpEntry(entry) && SUBSTITUTION_OPS.has(entry.op)) {
      return `process substitution \`${entry.op})\` (runs an inner command no allowlist inspects)`
    }
  }
  return undefined
}

function checkCommand(
  command: string,
  payload: { transcript_path?: string | undefined },
): void {
  const bypass = shellInjectionBypass(command)
  if (!bypass) {
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
      '[no-shell-injection-bypass-guard] Blocked: command-allowlist bypass',
      '',
      `  ${bypass}.`,
      '',
      '  These shell constructs route around the fleet Bash allowlists +',
      '  findInvocation guards. They have no legitimate fleet use. (`$(...)`,',
      '  `${...}`, and backticks are NOT blocked — only the evasion-only forms.)',
      '',
      `  If you genuinely need this, type the phrase in a new message:`,
      `  ${BYPASS_PHRASE}`,
    ].join('\n'),
  )
  process.exitCode = 2
}

if (process.argv[1]?.endsWith('index.mts')) {
  // Async IIFE: await inside the function (no top-level await — CJS bundle
  // target), promise still awaited. withBashGuard drains stdin, gates Bash,
  // narrows the command, fails open on throw.
  void (async () => {
    await withBashGuard(checkCommand)
  })()
}
