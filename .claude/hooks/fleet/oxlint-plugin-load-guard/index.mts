#!/usr/bin/env node
// Claude Code PostToolUse hook — oxlint-plugin-load-guard.
//
// After an Edit/Write touches `.config/fleet/oxlint-plugin/**`, re-verify that
// the whole socket/ plugin still LOADS and registers every rule. A broken
// import in any rule or lib helper disables EVERY socket/ rule — oxlint only
// warns and never checks the rule count, so a green lint can hide a dead
// plugin. This is the edit-time complement to the commit-time gate
// `scripts/fleet/check/oxlint-plugin-loads.mts` (defense in depth): catch the
// breakage the moment it's introduced, in the same session, before it rides a
// cascade out to the fleet.
//
// PostToolUse (not PreToolUse) so the edit lands on disk first — the load check
// must import the just-written file. Reporting only, never blocks (exit 0): the
// edit is already applied, so this surfaces the breakage as a loud warning the
// author acts on, rather than a hard gate that can't un-apply the write.
//
// Delegates the actual check to the canonical script so there's one source of
// load-verification logic. Skips silently when the script or plugin is absent
// (scaffolding-only repos) and fails open on any error.

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { withEditGuard } from '../_shared/payload.mts'

const logger = getDefaultLogger()

// Anchor on CLAUDE_PROJECT_DIR (the repo root the session opened), falling back
// to cwd. Stable regardless of how deep the hook lives — a hardcoded `..` count
// from the hook's own location breaks the moment the hook dir moves.
const repoRoot = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
const checkScript = path.join(
  repoRoot,
  'scripts',
  'fleet',
  'check',
  'oxlint-plugin-loads.mts',
)

// Only re-check when the edit touched a plugin source file.
export function isPluginPath(filePath: string): boolean {
  return filePath.includes('.config/fleet/oxlint-plugin/')
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow, and
// fail-open on any throw. PostToolUse — reporting only, never blocks.
await withEditGuard(filePath => {
  if (!filePath || !isPluginPath(filePath)) {
    return
  }
  const result = spawnSync('node', [checkScript], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  // status 0 = plugin loads + rule count matches → nothing to say.
  // Non-zero = the canonical script already printed the precise failure
  // (load threw / empty rules / count mismatch); echo a pointer so the
  // breakage is impossible to miss right after the edit.
  if (result.status !== 0) {
    logger.error(
      `🚨 oxlint-plugin-load-guard: the socket/ oxlint plugin no longer loads cleanly after editing ${filePath}. Every socket/ rule is disabled until this is fixed. Details above (from check-oxlint-plugin-loads.mts); run \`node scripts/fleet/check/oxlint-plugin-loads.mts\` to re-check.`,
    )
    const detail = String(result.stdout ?? '').trim()
    if (detail) {
      logger.error(detail)
    }
  }
})
