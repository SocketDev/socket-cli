#!/usr/bin/env node
// Claude Code PreToolUse hook — upstream-is-read-only-guard.
//
// Blocks an Edit / Write / MultiEdit / NotebookEdit whose target sits under an
// `upstream/` reference tree. A vendored upstream is READ ONLY: it exists to be
// read from and ported out of, and its whole value is being byte-identical to
// the `ref =` pinned in `.gitmodules`. An edit there is never a fix, it is
// corruption of the reference the port is measured against.
//
// Why this exists (incident 2026-08-04): a fleet lint autofix rewrote `null` →
// `undefined` inside `upstream/actions-checkout/__test__/*.test.ts`, the
// UPSTREAM's own tests. That drifted the tree off its pin, and the drift only
// surfaced when lockstep rows were finally added and the harness reported
// `submodule HEAD (de0fac2e4500) does not match .gitmodules ref (3d3c42e5aac5)`.
// Nothing had flagged the write itself. `upstream` is already in
// NEVER_GATED_SEGMENTS so the linter should not have reached it; this guard is
// the belt to that suspenders, catching ANY writer rather than one lint path.
//
// Restoring a vendored tree TO its pin is the sanctioned repair and is not an
// edit — it runs through git (`git -C upstream/<name> checkout --detach <ref>`),
// which this hook never sees. no-revert-guard carves that out separately.
//
// Bypass: `Allow upstream-edit bypass` in a recent user turn. Reach for it only
// to stage a patch you are about to send upstream, never to "fix" vendored code
// in place — a local fix silently diverges every port taken from it afterward.
//
// Fails open on hook bugs (exit 0 + stderr log).

import path from 'node:path'
import process from 'node:process'

import { block, defineHook, runHook } from '../_shared/guard.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])

/**
 * True when `filePath` sits inside an `upstream/` reference tree. Matches the
 * segment anywhere in the path, so a nested workspace package's own
 * `upstream/` is covered and the check never depends on the repo root being
 * resolvable. Backslashes are folded first so a Windows path matches too.
 */
export function isUpstreamPath(filePath: string): boolean {
  const p = filePath.replaceAll('\\', '/')
  return (
    p === 'upstream' || p.startsWith('upstream/') || p.includes('/upstream/')
  )
}

export const check = (payload: ToolCallPayload): GuardResult => {
  // The cascade materializes and repins upstream trees; it is the sanctioned
  // writer and runs with this set.
  if (process.env['FLEET_SYNC'] === '1') {
    return undefined
  }
  if (!payload.tool_name || !EDIT_TOOLS.has(payload.tool_name)) {
    return undefined
  }
  const filePath = (
    payload.tool_input as { file_path?: unknown | undefined } | undefined
  )?.file_path
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return undefined
  }
  if (!isUpstreamPath(path.resolve(resolveProjectDir(), filePath))) {
    return undefined
  }
  return block(
    [
      `[upstream-is-read-only-guard] Blocked: ${payload.tool_name} ${filePath}`,
      '',
      '  This file is inside an `upstream/` reference tree. Those are vendored',
      '  READ-ONLY: their value is being byte-identical to the `ref =` pinned',
      '  in `.gitmodules`, so an edit corrupts the reference every port is',
      '  measured against, and drifts the tree off its pin.',
      '',
      '  Do this instead:',
      '  - Porting FROM it? Write the port in our tree and leave the source',
      '    untouched. lockstep records the pin it was ported at.',
      '  - Tree already drifted? Restore it, do not hand-edit:',
      '      git -C upstream/<name> checkout --detach <ref from .gitmodules>',
      '  - Moving the pin? Repin via `scripts/fleet/vendor-actions.mts`, then',
      '    `node scripts/repo/gen/gitmodules-hash.mts --set`.',
      '  - Genuinely sending a patch upstream? That is the one bypass case.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['upstream-edit'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'NotebookEdit', 'Write'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
