#!/usr/bin/env node
// Claude Code PostToolUse hook — oxlint-plugin-load-nudge.
//
// renamed-from: oxlint-plugin-load-guard
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

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'
import { isPluginPath } from './is-plugin-path.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

// The repo root of the EDITED plugin file — every plugin path contains the
// `.config/fleet/oxlint-plugin/` marker, so the root is the segment before
// it. Anchoring on the file (not CLAUDE_PROJECT_DIR) means editing a SIBLING
// repo's plugin verifies THAT repo's plugin, not the session repo's. Falls
// back to the session root when the marker isn't present (isPluginPath
// guarantees it is).
const PLUGIN_MARKER = '.config/fleet/oxlint-plugin/'
export function pluginRepoRoot(filePath: string): string {
  const normalized = normalizePath(filePath)
  const idx = normalized.indexOf(`/${PLUGIN_MARKER}`)
  /* c8 ignore next - isPluginPath gates callers, so the marker is always present */
  return idx === -1 ? resolveProjectDir() : normalized.slice(0, idx)
}

export const check = editGuard(filePath => {
  if (!filePath || !isPluginPath(filePath)) {
    return undefined
  }
  const repoRoot = pluginRepoRoot(filePath)
  const checkScript = path.join(
    repoRoot,
    'scripts',
    'fleet',
    'check',
    'oxlint-plugin-loads.mts',
  )
  const result = spawnSync('node', [checkScript], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  // status 0 = plugin loads + rule count matches → nothing to say.
  // Non-zero = the canonical script already printed the precise failure
  // (load threw / empty rules / count mismatch); echo a pointer so the
  // breakage is impossible to miss right after the edit.
  if (result.status !== 0) {
    const detail = String(result.stdout ?? '').trim()
    const msg =
      `🚨 oxlint-plugin-load-nudge: the socket/ oxlint plugin no longer loads cleanly after editing ${filePath}. Every socket/ rule is disabled until this is fixed. Details above (from check-oxlint-plugin-loads.mts); run \`node scripts/fleet/check/oxlint-plugin-loads.mts\` to re-check.` +
      (detail ? `\n${detail}` : '')
    return notify(msg)
  }
  return undefined
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Edit', 'Write'],
  scope: 'convention',
  type: 'nudge',
})

/* c8 ignore next - standalone entrypoint only; never runs during import in tests */
void runHook(hook, import.meta.url)
