#!/usr/bin/env node
// Claude Code SessionStart hook — copy-on-select-hint-reminder.
//
// The fleet hardens `~/.claude.json` with `copyOnSelect: false` (setup step
// scripts/fleet/setup/claude-config.mts) so the TUI stops auto-copying mouse
// selections and emitting OSC-52 clipboard escapes — that kills the iTerm2
// "terminal attempted to access the clipboard" banner.
//
// Side effect: under a mouse-reporting terminal the TUI captures drag events,
// so a plain drag-select no longer reaches the terminal AND (with copyOnSelect
// off) is not auto-copied either. Mouse copy still works — you just hold Option
// (the Mac ⌥ / alt key) while dragging to bypass mouse reporting and make a
// native terminal selection, then Cmd-C or right-click → Copy.
//
// True runtime mouse-reporting state is not visible to a hook (the TUI toggles
// it on the fly via escape sequences — it is in no file). But the static combo
// that produces the surprise IS detectable: `copyOnSelect: false` in the global
// config + a mouse-reporting-capable terminal. When both hold, this hook prints
// the Option-drag hint once as SessionStart additionalContext. Otherwise it
// stays silent.
//
// Pure-informational: never blocks, never writes, never fails the session.

import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// Terminals that drive mouse reporting (so a full-screen app captures the
// mouse and plain drag-select stops reaching the terminal). Hold-Option to
// select is the standard escape hatch in all of them.
const MOUSE_REPORTING_TERMINALS = new Set([
  'Apple_Terminal',
  'WezTerm',
  'ghostty',
  'iTerm.app',
  'vscode',
])

export function globalConfigPath(): string {
  return path.join(os.homedir(), '.claude.json')
}

// Is the global config hardened to copyOnSelect:false? Reads the file directly
// (the client's getGlobalConfig is not reachable from a hook). Absent /
// unreadable / unset / true → false; only an explicit `false` counts.
export function copyOnSelectDisabled(configPath: string): boolean {
  if (!existsSync(configPath)) {
    return false
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
      string,
      unknown
    >
    return parsed['copyOnSelect'] === false
  } catch {
    return false
  }
}

// Does the current terminal drive mouse reporting? Keyed off TERM_PROGRAM,
// which the terminal sets in the environment.
export function isMouseReportingTerminal(
  termProgram: string | undefined,
): boolean {
  return termProgram !== undefined && MOUSE_REPORTING_TERMINALS.has(termProgram)
}

// The hint to show, or undefined when the surprising combo is not present.
// Pure — the test drives it directly.
export function copyHint(
  configPath: string,
  termProgram: string | undefined,
): string | undefined {
  if (
    !copyOnSelectDisabled(configPath) ||
    !isMouseReportingTerminal(termProgram)
  ) {
    return undefined
  }
  return (
    'copyOnSelect is off, so a plain mouse drag will not auto-copy. ' +
    'To copy text by mouse, hold Option (⌥ / alt) while dragging — the ' +
    'terminal then handles the drag as a native selection instead of sending ' +
    'it to the app, and you can re-drag (still holding Option) to adjust or ' +
    'replace an existing selection. Then Cmd-C or right-click → Copy. ' +
    '(ctrl+c and /copy are unaffected.)'
  )
}

export function emitSessionStartContext(message: string): void {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `[copy-on-select-hint] ${message}`,
    },
  }
  process.stdout.write(JSON.stringify(out))
}

async function main(): Promise<void> {
  const hint = copyHint(globalConfigPath(), process.env['TERM_PROGRAM'])
  if (hint) {
    emitSessionStartContext(hint)
  }
}

if (process.argv[1]?.endsWith('index.mts')) {
  // Async IIFE: await inside the function (no top-level await — CJS bundle
  // target), promise still awaited. Fail-closed — never block session start.
  void (async () => {
    try {
      await main()
    } catch (e) {
      logger.fail(`copy-on-select-hint-reminder hook error: ${String(e)}`)
      process.exit(0)
    }
  })()
}
