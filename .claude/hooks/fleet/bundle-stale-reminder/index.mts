#!/usr/bin/env node
// Claude Code PostToolUse hook — bundle-stale-reminder.
//
// renamed-from: bundle-stale-guard
//
// Mirrors extension-build-current-reminder. Fires after an Edit/Write whose
// path is a hook-bundle SOURCE: the `_dispatch/` dispatcher, the generated
// `dispatch-table.mts`, any bundled hook's `index.mts`, or anything under
// `_shared/`. When the edited source is NEWER than the built
// `_dist/bundle.cjs`, the bundle is stale and the operator is reminded to
// rebuild it with `node scripts/fleet/build-hook-bundle.mts`.
//
// The hook is a REMINDER, never a block: it only writes to stderr and always
// exits 0. PostToolUse can't reject the prior tool call anyway.
//
// Bypass: `Allow hook-bundle-current bypass` (silences the reminder when the
// rebuild is genuinely deferred). See docs/agents.md/fleet/hook-bundle.md.

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isHookEntrypoint } from '../_shared/entrypoint.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

export interface BundleStalePayload {
  readonly cwd?: string | undefined
  readonly hook_event_name?: string | undefined
  readonly tool_input?: { readonly file_path?: unknown | undefined } | undefined
  readonly tool_name?: string | undefined
  readonly transcript_path?: string | undefined
}

// Read by scripts/fleet/gen/hook-dispatch.mts to place this hook in the
// static dispatch table (the bundled fast-path). PostToolUse, Edit|Write.
export const DISPATCH_EVENT = 'PostToolUse'
export const DISPATCH_TOOLS: readonly string[] = ['Edit', 'Write']

const BYPASS_PHRASE = 'Allow hook-bundle-current bypass'
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
 * source file (mtime comparison). A missing bundle is treated as stale.
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
 * Builds the multi-line stderr reminder.
 */
export function formatReminder(sourceRel: string): string {
  return (
    [
      `[bundle-stale-reminder] Edited a hook-bundle source without rebuilding the bundle.`,
      ``,
      `  Source:  ${sourceRel}`,
      `  Bundle:  ${BUNDLE_REL}`,
      `           (+ ${TEMPLATE_BUNDLE_REL} in the wheelhouse) — missing or older than the source`,
      ``,
      `  Rebuild so warm hook dispatch loads current code:`,
      `    node scripts/fleet/build-hook-bundle.mts`,
      ``,
      `  Deferring the rebuild on purpose? Type "${BYPASS_PHRASE}".`,
    ].join('\n') + '\n'
  )
}

/**
 * Core hook logic, decoupled from process I/O so the dispatcher bundle can
 * call it directly. Returns the reminder text when the bundle is stale, or
 * undefined when there is nothing to say.
 */
export function run(payload: BundleStalePayload): string | undefined {
  if (payload.hook_event_name && payload.hook_event_name !== 'PostToolUse') {
    return undefined
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    return undefined
  }
  const filePath =
    typeof payload.tool_input?.file_path === 'string'
      ? payload.tool_input.file_path
      : ''
  if (!filePath || !isBundledSource(filePath)) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
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
  return formatReminder(sourceRel)
}

/* c8 ignore start - process-entrypoint I/O; only reachable when invoked as main script */
async function readStdin(): Promise<string> {
  let raw = ''
  for await (const chunk of process.stdin) {
    raw += chunk
  }
  return raw
}

async function main(): Promise<void> {
  let raw: string
  try {
    raw = await readStdin()
  } catch {
    process.exit(0)
  }
  if (!raw.trim()) {
    process.exit(0)
  }
  let payload: BundleStalePayload
  try {
    payload = JSON.parse(raw) as BundleStalePayload
  } catch {
    process.exit(0)
  }
  const reminder = run(payload)
  if (reminder) {
    process.stderr.write(reminder)
  }
  // Reminder-only: never blocks.
  process.exit(0)
}

// Entrypoint-guarded: run main() only when invoked directly, NOT when the test
// or the dispatch bundle imports this module for its pure `run` helper.
// `isHookEntrypoint` also short-circuits inside a snapshot build pass, where the
// absolute-`--build-snapshot`-path coincidence would otherwise fire this guard
// during the build and abort serialization (see _shared/entrypoint.mts).
if (isHookEntrypoint(import.meta.url)) {
  main().catch(() => {
    process.exit(0)
  })
}
/* c8 ignore stop */
