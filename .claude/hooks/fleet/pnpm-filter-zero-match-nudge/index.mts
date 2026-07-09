#!/usr/bin/env node
// Claude Code PostToolUse hook — pnpm-filter-zero-match-nudge.
//
// After a Bash command that ran `pnpm --filter <name> run x`, if the
// tool output contains "No projects matched the filters", the command
// was a silent no-op: pnpm exits 0 even when zero packages matched.
//
// This is a known footgun that has false-greened builds: a typo in the
// filter name produces an exit-0 no-op with no visible error, making it
// look like the script ran when it did not.
//
// On match this hook emits a non-blocking nudge naming the failure and
// suggesting `pnpm ls --filter <name> --depth -1` to verify the package
// name. Never blocks (exit 0) — the Bash tool has already completed.

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { extractOutput } from '../enterprise-push-nudge/index.mts'

// The sentinel pnpm prints when no workspace packages matched the filter.
// Stable across pnpm versions (verified pnpm 8 and 9).
const ZERO_MATCH_PATTERN = /No projects matched the filters/

export function isZeroMatch(output: string): boolean {
  return ZERO_MATCH_PATTERN.test(output)
}

export function extractFilterName(command: string): string | undefined {
  // Parse `--filter <name>` or `--filter=<name>` from the command string.
  // Handles quoted names and both flag forms.
  const m =
    /--filter[= ](['"]?)([^\s'"]+)\1/.exec(command) ??
    /--filter[= ]["']([^'"]+)["']/.exec(command)
  return m ? (m[2] ?? m[1]) : undefined
}

export function formatNudge(command: string): string {
  const filterName = extractFilterName(command)
  const lines: string[] = []
  lines.push('')
  lines.push('ℹ pnpm-filter-zero-match-nudge')
  lines.push('')
  if (filterName) {
    lines.push(
      `\`--filter ${filterName}\` matched zero workspace packages — pnpm exited 0 as a silent no-op.`,
    )
    lines.push('')
    lines.push('The command did not run in any package. Verify the name:')
    lines.push('')
    lines.push(`  pnpm ls --filter ${filterName} --depth -1`)
  } else {
    lines.push(
      '`--filter <name>` matched zero workspace packages — pnpm exited 0 as a silent no-op.',
    )
    lines.push('')
    lines.push(
      'The command did not run in any package. Verify the filter name with `pnpm ls --filter <name> --depth -1`.',
    )
  }
  lines.push('')
  return lines.join('\n')
}

export const check = bashGuard((command, payload) => {
  // Only inspect commands that used --filter (the zero-match path requires it).
  if (!command.includes('--filter')) {
    return undefined
  }
  // Read the tool output from the PostToolUse payload.
  const toolResponse = (payload as { tool_response?: unknown | undefined })
    .tool_response
  const output = extractOutput(toolResponse)
  if (!isZeroMatch(output)) {
    return undefined
  }
  return notify(formatNudge(command))
})

export const triggers: readonly string[] = ['--filter']

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  triggers,
  type: 'nudge',
})
void runHook(hook, import.meta.url)
