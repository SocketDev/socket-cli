#!/usr/bin/env node
// Claude Code PostToolUse hook — stale-node-modules-nudge.
//
// After a Bash command fails with a Node module-resolution error for a
// workspace package (commonly the repo's `-stable` self-alias), surface
// the canonical fix: run `pnpm install` to relink node_modules.
//
// Why: `pnpm` symlinks the main checkout's `node_modules` and, after a
// `git worktree remove` / `prune`, can leave those links dangling into
// the removed worktree. The next hook or script that imports a workspace
// package then dies with:
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find package
//   '@socketsecurity/lib-stable' imported from .../pre-commit.mts
// A pre-commit hook hitting this blocks every commit until `pnpm install`
// relinks the store — easy to misread as a content failure.
//
// This hook detects two faces of the SAME dangle and steers to one
// headless-safe fix:
//   1. Bash output with ERR_MODULE_NOT_FOUND / "Cannot find package" for a
//      scoped workspace package (`@<scope>/...`) — the dangling symlink.
//   2. Bash output with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY — the
//      follow-on trap where `pnpm install` (the obvious fix) itself dies
//      because pnpm wants to purge the stale modules dir and has no TTY to
//      confirm. Without handling this, the suggested fix is blocked and we
//      step on ourselves.
//
// On match it returns a non-blocking notice to run the headless-safe relink
// (`pnpm install --config.confirmModulesPurge=false`). It does NOT run the
// install or retry — the operator decides.
//
// PostToolUse, not PreToolUse: we react to the failure; we don't predict
// it. Fail-open on hook bugs (notice only, never blocks).

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// Both signals together identify a workspace-package resolution break:
// the ERR code (or "Cannot find package") AND a scoped package name. We
// require the scoped name so a generic "module not found" for a typo'd
// relative import doesn't fire.
const ERR_PATTERNS: readonly RegExp[] = [
  /ERR_MODULE_NOT_FOUND/,
  /Cannot find package/,
  /Cannot find module/,
]
const SCOPED_PKG_RE = /@[a-z0-9][\w.-]*\/[\w./-]+/i

// The second face of the dangle: when `pnpm install` tries to relink, it
// sees a stale modules dir it must purge and refuses to remove it without a
// TTY to confirm. In the headless / `!`-channel the prompt can't be
// answered, so the relink — the very fix this hook suggests — dies. This
// signal needs NO scoped-package name; the error code alone identifies it.
const PNPM_NO_TTY_PURGE_RE = /ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY/

// The headless-safe relink. `--config.confirmModulesPurge=false` lets pnpm
// remove+rebuild the modules dir without a TTY prompt, so the fix runs in
// the `!`-channel / CI without stepping on ourselves.
const HEADLESS_RELINK = 'pnpm install --config.confirmModulesPurge=false'

// Read the Bash tool_response into a string. Shape is typically
// `{ stdout, stderr, interrupted, isImage }` but harness variants may
// pass a bare string. Walk both.
export function extractOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of ['stdout', 'stderr', 'output', 'content']) {
      const v = obj[key]
      if (typeof v === 'string') {
        parts.push(v)
      }
    }
    return parts.join('\n')
  }
  return ''
}

export function isWorkspaceResolutionBreak(output: string): boolean {
  const hasErr = ERR_PATTERNS.some(re => re.test(output))
  if (!hasErr) {
    return false
  }
  return SCOPED_PKG_RE.test(output)
}

// True when the output is the no-TTY modules-purge abort — `pnpm install`
// blocked on a confirmation prompt it can't show.
export function isNoTtyPurgeAbort(output: string): boolean {
  return PNPM_NO_TTY_PURGE_RE.test(output)
}

// Which dangle face fired, or undefined for neither.
//   'resolution' — the import failed (dangling symlink).
//   'purge-abort' — the relink itself was blocked on a TTY prompt.
export type DangleKind = 'purge-abort' | 'resolution'

export function detectDangle(output: string): DangleKind | undefined {
  // Check the purge-abort first: when both appear (a relink attempt that
  // tripped the prompt), the actionable signal is the abort, not the
  // resolution error that prompted the relink.
  if (isNoTtyPurgeAbort(output)) {
    return 'purge-abort'
  }
  if (isWorkspaceResolutionBreak(output)) {
    return 'resolution'
  }
  return undefined
}

// Pull the first scoped package name out of the output for the message.
export function offendingPackage(output: string): string | undefined {
  const m = SCOPED_PKG_RE.exec(output)
  return m ? m[0] : undefined
}

export function formatReminder(
  kind: DangleKind,
  pkg: string | undefined,
): string {
  const lines: string[] = []
  lines.push('')
  lines.push('ℹ stale-node-modules-nudge')
  lines.push('')
  if (kind === 'purge-abort') {
    lines.push(
      '`pnpm install` aborted: it wants to purge a stale modules dir but has',
    )
    lines.push(
      'no TTY to confirm (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). This is',
    )
    lines.push('the same worktree-removal dangle — the relink just needs the')
    lines.push('non-interactive purge flag.')
  } else {
    lines.push(
      `That \`Cannot find package\`${pkg ? ` (${pkg})` : ''} is almost always`,
    )
    lines.push(
      "a dangling pnpm symlink: pnpm relinked the main checkout's node_modules",
    )
    lines.push('into a worktree that was since removed/pruned.')
  }
  lines.push('')
  lines.push('Fix (headless-safe — works in the `!`-channel / CI, no TTY):')
  lines.push(`  ${HEADLESS_RELINK}`)
  lines.push('')
  lines.push('Run it in the MAIN checkout, then retry. Do NOT bypass the')
  lines.push('failing hook with --no-verify — the break is transient, not a')
  lines.push('reason to ship around the gate.')
  lines.push('')
  return lines.join('\n')
}

// Read the Bash `tool_response` off the PostToolUse payload. Not part of the
// shared `ToolCallPayload` (those fields cover `tool_input`), so narrow it
// here. Optional + unknown so a shape surprise can't crash the read.
function readToolResponse(payload: ToolCallPayload): unknown {
  return (payload as { tool_response?: unknown | undefined }).tool_response
}

export const check = bashGuard((_command, payload) => {
  const output = extractOutput(readToolResponse(payload))
  const kind = detectDangle(output)
  if (!kind) {
    return undefined
  }
  return notify(formatReminder(kind, offendingPackage(output)))
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
