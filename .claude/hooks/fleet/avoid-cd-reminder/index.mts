#!/usr/bin/env node
// Claude Code PreToolUse hook — avoid-cd-reminder.
//
// The Bash tool's working directory PERSISTS across tool calls. That's
// useful for chaining commands but easy to lose track of: a `cd` in
// turn N puts every later command in a different cwd until something
// resets it. The assistant has burned multiple tool calls realizing
// cwd had drifted — see e.g. "Wait — patch ran from current dir.
// But the current dir isn't lsquic upstream."
//
// The fix is one of:
//   (a) prefer absolute paths inside a single command — no cd needed:
//         patch --dry-run -p1 -d /abs/path/to/source < /abs/path/to/file.patch
//   (b) keep the cd local to the command via `()` subshell — pwd is
//       confined to the subshell, parent cwd unchanged:
//         (cd /abs/path && make)
//   (c) end the command with `&& pwd` so the next tool call shows
//       evidence in the log where the cwd actually ended up:
//         cd /abs/path && some-command && pwd
//
// This hook fires on Bash commands that contain a bare `cd <path>`
// without one of the above safeguards. Stderr reminder; never blocks.
//
// Scope: Bash tool only. Skips:
//   - `cd ` inside a `()` subshell (pattern (b) — safe)
//   - `cd ` followed by `&& pwd` or `; pwd` at the end (pattern (c) —
//     evidenced)
//   - `cd -` (return to previous dir, intentional)
//   - `cd <path> 2>/dev/null` short forms used for existence probes
//     (caller knows what they're doing)
//
// Disable via SOCKET_AVOID_CD_REMINDER_DISABLED.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import process from 'node:process'

import { withBashGuard } from '../_shared/payload.mts'

const logger = getDefaultLogger()

// Matches `cd <something>` not preceded by `(` (subshell) and not
// followed by anything that suggests evidence-capture.
function detectsBareCd(command: string): boolean {
  // Strip line continuations + collapse whitespace for easier matching.
  const flat = command.replace(/\\\n/g, ' ').replace(/\s+/g, ' ')

  // Find every `cd ` occurrence and inspect each one's context.
  const cdRe = /(^|[\s;&|])cd\s+(\S+)/g
  let m: RegExpExecArray | null
  while ((m = cdRe.exec(flat)) !== null) {
    const target = m[2]!

    // Skip `cd -` (intentional return).
    if (target === '-') {
      continue
    }
    // Skip subshell form: `(cd path && ...)`. We look backwards in
    // the flattened string for an unmatched `(` before the cd.
    const pre = flat.slice(0, m.index)
    const opens = (pre.match(/\(/g) ?? []).length
    const closes = (pre.match(/\)/g) ?? []).length
    if (opens > closes) {
      continue
    }
    // Skip if the lead is empty AND we're at the very start AND the
    // command ends with `&& pwd` or `; pwd` — evidence pattern.
    if (/(?:&&|;)\s*pwd\b\s*$/.test(flat)) {
      continue
    }
    // Skip the bare-existence-probe shape: `cd <path> 2>/dev/null && …`.
    // The `2>/dev/null` redirect signals the caller is using cd as a
    // probe, not a permanent move.
    const tail = flat.slice(m.index + m[0].length)
    if (/^\s*2>\s*\/dev\/null/.test(tail)) {
      continue
    }
    // Bare cd that persists across tool calls.
    return true
  }
  return false
}

// withBashGuard handles the stdin drain, tool_name gate, command narrow,
// and fail-open on any throw. The env-var disable and the bare-cd check
// run inside the callback.
await withBashGuard(command => {
  if (process.env['SOCKET_AVOID_CD_REMINDER_DISABLED']) {
    return
  }
  if (!detectsBareCd(command)) {
    return
  }
  logger.error(
    [
      '[avoid-cd-reminder] Bash command contains a bare `cd <path>`.',
      '',
      "  The Bash tool's cwd PERSISTS across tool calls — a cd here lingers",
      '  for every later command until something resets it. Recover with one',
      '  of:',
      '',
      '    (a) Use absolute paths so no cd is needed:',
      '          patch -p1 -d /abs/path < /abs/file.patch',
      '',
      '    (b) Confine the cd to a subshell:',
      '          (cd /abs/path && make)',
      '',
      '    (c) Capture the resulting cwd so the next call can see it:',
      '          cd /abs/path && some-command && pwd',
      '',
      '  Disable: SOCKET_AVOID_CD_REMINDER_DISABLED=1',
      '',
    ].join('\n'),
  )
})
