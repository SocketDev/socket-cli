#!/usr/bin/env node
// Claude Code PostToolUse hook — bundle-stale-reminder.
//
// renamed-from: bundle-stale-guard
//
// Fires after an Edit/Write whose path is a hook-bundle SOURCE: the
// `_dispatch/` dispatcher, the generated `dispatch-table.mts`, any bundled
// hook's `index.mts`, or anything under `_shared/`. When the edited source is
// NEWER than the built `_dist/bundle.cjs`, the bundle is stale and the
// operator is reminded to rebuild it with
// `node scripts/fleet/build-hook-bundle.mts`.
//
// The hook is a REMINDER, never a block: it returns a notify verdict, so the
// tool call always proceeds. PostToolUse can't reject the prior tool call
// anyway.
//
// Bypass: the `hook-bundle-current` slug is declared as `bypass` metadata on
// defineHook — the framework wires phrase detection and the uniform footer
// from that one array, so typing the phrase silences the reminder when the
// rebuild is genuinely deferred. See docs/agents.md/fleet/hook-bundle.md.

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { readFilePath } from '../_shared/payload.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

const BUNDLE_REL = '.claude/hooks/fleet/_dist/bundle.cjs'
// The wheelhouse holds TWO bundles: the live one (above) and the cascaded
// canonical under template/base/. A hook-source edit leaves both stale until
// `build-hook-bundle.mts` rebuilds them, so the reminder must watch both.
const TEMPLATE_BUNDLE_REL = `template/base/${BUNDLE_REL}`
const DISPATCH_DIR_FRAGMENT = '.claude/hooks/fleet/_dispatch/'
const SHARED_DIR_FRAGMENT = '.claude/hooks/fleet/_shared/'
const FLEET_HOOK_INDEX_RE = /\.claude\/hooks\/fleet\/[^/]+\/index\.mts$/

/**
 * Returns true when filePath is a source that the hook bundle is built from:
 * the dispatcher / dispatch-table under `_dispatch/`, any fleet hook's
 * `index.mts`, or anything under `_shared/`. Path is normalized to `/` first
 * so the match is the same on darwin / linux / win32.
 */
export function isBundledSource(filePath: string): boolean {
  const norm = normalizePath(filePath)
  if (norm.endsWith(BUNDLE_REL) || norm.includes(`${DISPATCH_DIR_FRAGMENT}`)) {
    // The bundle output itself is not a source; only the .mts under _dispatch/.
    if (norm.endsWith(BUNDLE_REL)) {
      return false
    }
    return norm.endsWith('.mts')
  }
  if (norm.includes(SHARED_DIR_FRAGMENT) && norm.endsWith('.mts')) {
    return true
  }
  return FLEET_HOOK_INDEX_RE.test(norm)
}

/**
 * Walks up from `start` looking for a directory that contains `package.json`
 * AND the `.claude/hooks/fleet/` tree. Returns the path or undefined.
 */
export function findRepoRoot(start: string): string | undefined {
  let cur = start
  for (let i = 0; i < 12; i += 1) {
    if (
      existsSync(path.join(cur, 'package.json')) &&
      existsSync(path.join(cur, '.claude', 'hooks', 'fleet'))
    ) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      return undefined
    }
    cur = parent
  }
  return undefined
}

/**
 * The bundle paths relevant to this repo: always the live bundle, plus the
 * cascaded canonical under `template/base/` when this IS the wheelhouse (that
 * tree is wheelhouse-only — members never have it, so they only check live).
 */
export function relevantBundleRels(repoRoot: string): readonly string[] {
  const templateFleetDir = path.join(
    repoRoot,
    'template',
    'base',
    '.claude',
    'hooks',
    'fleet',
  )
  return existsSync(templateFleetDir)
    ? [BUNDLE_REL, TEMPLATE_BUNDLE_REL]
    : [BUNDLE_REL]
}

/**
 * Returns true when any relevant bundle is missing, or older than the edited
 * source file, mtime comparison. A missing bundle is treated as stale.
 */
export function bundleIsStale(
  repoRoot: string,
  sourceAbsPath: string,
): boolean {
  let sourceMtime: number
  try {
    sourceMtime = statSync(sourceAbsPath).mtimeMs
  } catch {
    return false
  }
  for (const rel of relevantBundleRels(repoRoot)) {
    const bundlePath = path.join(repoRoot, rel)
    if (!existsSync(bundlePath)) {
      return true
    }
    try {
      if (sourceMtime > statSync(bundlePath).mtimeMs) {
        return true
      }
    } catch {
      /* c8 ignore start - TOCTOU: bundle deleted between existsSync and statSync */
      return false
      /* c8 ignore stop */
    }
  }
  return false
}

/**
 * Builds the multi-line reminder. The bypass instruction is NOT part of the
 * message — defineHook appends the uniform footer from the `bypass` metadata.
 */
export function formatReminder(sourceRel: string): string {
  return [
    `[bundle-stale-reminder] Edited a hook-bundle source without rebuilding the bundle.`,
    ``,
    `  Source:  ${sourceRel}`,
    `  Bundle:  ${BUNDLE_REL}`,
    `           (+ ${TEMPLATE_BUNDLE_REL} in the wheelhouse) — missing or older than the source`,
    ``,
    `  Rebuild so warm hook dispatch loads current code:`,
    `    node scripts/fleet/build-hook-bundle.mts`,
  ].join('\n')
}

/**
 * Core hook logic, decoupled from process I/O so the dispatcher bundle can
 * call it via the `check` seam. Returns a notify verdict when the bundle is
 * stale, or undefined when there is nothing to say.
 */
export const check = (payload: ToolCallPayload): GuardResult => {
  const eventName = (payload as { hook_event_name?: unknown | undefined })
    .hook_event_name
  if (eventName && eventName !== 'PostToolUse') {
    return undefined
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    return undefined
  }
  const filePath = readFilePath(payload)
  if (!filePath || !isBundledSource(filePath)) {
    return undefined
  }
  const cwd = resolveProjectDir(
    typeof payload.cwd === 'string' ? payload.cwd : undefined,
  )
  const repoRoot = findRepoRoot(cwd) ?? findRepoRoot(path.dirname(filePath))
  if (!repoRoot) {
    return undefined
  }
  const sourceAbs = path.isAbsolute(filePath)
    ? filePath
    : path.join(repoRoot, filePath)
  if (!bundleIsStale(repoRoot, sourceAbs)) {
    return undefined
  }
  const sourceRel = path.relative(repoRoot, sourceAbs) || filePath
  return notify(formatReminder(sourceRel))
}

export const hook = defineHook({
  bypass: ['hook-bundle-current'],
  check,
  event: 'PostToolUse',
  matcher: ['Edit', 'Write'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
