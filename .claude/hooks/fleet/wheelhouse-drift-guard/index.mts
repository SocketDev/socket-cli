#!/usr/bin/env node
// Claude Code PreToolUse hook — wheelhouse-drift-guard.
//
// @file The write-time twin of
//   scripts/fleet/check/wheelhouse-controlled-files-are-classified.mts. Blocks an
//   Edit / MultiEdit / Write to a ROOT COPY of a byte-controlled fleet path
//   (mirror / optional) that WOULD drift from its resolved template source, so a
//   wheelhouse-controlled file is edited only in `template/base` then re-cascaded
//   — never hand-patched at the root (the silent-drift class that shipped a stale
//   github-release.yml / npm-publish.yml). It never fires on a path under
//   `template/` (the canonical source), on an already-matching edit, on an
//   EXPECTED / PRESET / native-handler path (content varies per repo), or in a
//   member (no `template/base` → this is no-fleet-fork-guard's job).
//
// Wheelhouse-only in effect: the classification manifest + cascade resolver live
// under `scripts/repo/` (not cascaded), imported at runtime and guarded — a
// member fails open (allow).
//
// Fix: edit `template/base/<path>`, then re-cascade
//      (`node scripts/repo/sync.mts`).
//      Detail: docs/agents.md/fleet/wheelhouse-controlled-drift.md.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { NATIVE_HANDLER_FILES } from '../_shared/native-handler-files.mts'
import { resolveEditedText } from '../_shared/payload.mts'

/**
 * Injected classification + resolution seam (pure predicate below stays
 * testable, the `check` wires the real cascade engine at runtime).
 */
export interface WheelhouseDriftDeps {
  // True when `relPosix` is byte-controlled (under a mirror / optional entry).
  readonly isByteControlled: (relPosix: string) => boolean
  // True when `relPosix` is EXPECTED / PRESET / native-handler (content varies).
  readonly isExcluded: (relPosix: string) => boolean
  // The resolved template winner content for `relPosix` (base + kind +
  // overrides), or undefined when no layer provides it for this repo.
  readonly resolveWinnerContent: (relPosix: string) => string | undefined
}

/**
 * True when editing `filePath` (a root copy under `repoRoot`) to `content`
 * would drift it from its resolved template source. Pure: the manifest +
 * resolver are injected via `deps`. Never fires for a path under `template/`
 * (the source), an excluded (per-repo-varying) path, a path with no resolvable
 * winner, or an edit whose post-edit text already matches the winner.
 */
export function isWheelhouseControlledDrift(
  filePath: string,
  content: string | undefined,
  repoRoot: string,
  deps: WheelhouseDriftDeps,
): boolean {
  const norm = normalizePath(filePath)
  const rootNorm = normalizePath(repoRoot)
  if (norm !== rootNorm && !norm.startsWith(`${rootNorm}/`)) {
    return false
  }
  const rel = norm.slice(rootNorm.length + 1)
  // A path UNDER template/ is the canonical SOURCE, never a root copy.
  if (rel === 'template' || rel.startsWith('template/')) {
    return false
  }
  if (!deps.isByteControlled(rel) || deps.isExcluded(rel)) {
    return false
  }
  const winner = deps.resolveWinnerContent(rel)
  // No resolvable canonical source, or an undeterminable post-edit text — fail
  // open (can't prove drift).
  if (winner === undefined || content === undefined) {
    return false
  }
  return content !== winner
}

// The wheelhouse root for `filePath`: the nearest ancestor carrying
// `template/base`. undefined when there is none (a member / non-wheelhouse repo).
function findWheelhouseRoot(filePath: string): string | undefined {
  let dir = path.dirname(path.resolve(filePath))
  const { root } = path.parse(dir)
  for (;;) {
    if (existsSync(path.join(dir, 'template', 'base'))) {
      return dir
    }
    if (dir === root) {
      return undefined
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

function readFileSafe(abs: string): string | undefined {
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return undefined
  }
}

// Build the real deps from the wheelhouse-only cascade engine. scripts/repo/ is
// not cascaded, so the import is runtime + guarded; any failure (a member, a
// half-installed tree) fails open by returning undefined.
async function loadDeps(
  repoRoot: string,
): Promise<WheelhouseDriftDeps | undefined> {
  const manifestPath = path.join(
    repoRoot,
    'scripts/repo/sync-scaffolding/manifest.mts',
  )
  if (!existsSync(manifestPath)) {
    return undefined
  }
  try {
    const manifest = (await import(pathToFileURL(manifestPath).href)) as {
      IDENTICAL_FILES: readonly string[]
      OPTIONAL_IDENTICAL_FILES: readonly string[]
      PRESET_FILES: readonly string[]
      EXPECTED_FILES: readonly string[]
    }
    const layers = (await import(
      pathToFileURL(
        path.join(
          repoRoot,
          'scripts/repo/sync-scaffolding/template-layers.mts',
        ),
      ).href
    )) as {
      resolveTemplateSource: (
        relPath: string,
        options: unknown,
      ) => { winner: string | undefined }
      layerAbsPath: (layer: string, relPath: string) => string
    }
    const config = (await import(
      pathToFileURL(
        path.join(
          repoRoot,
          'scripts/repo/sync-scaffolding/socket-wheelhouse-config.mts',
        ),
      ).href
    )) as { composeOptionsFor: (targetDir: string) => unknown }
    const composeOpts = config.composeOptionsFor(repoRoot)
    const byteControlled = [
      ...manifest.IDENTICAL_FILES,
      ...manifest.OPTIONAL_IDENTICAL_FILES,
    ]
    const excluded = new Set<string>([
      ...manifest.EXPECTED_FILES,
      ...manifest.PRESET_FILES,
      ...NATIVE_HANDLER_FILES,
    ])
    return {
      isByteControlled: rel =>
        byteControlled.some(
          entry => rel === entry || rel.startsWith(`${entry}/`),
        ),
      isExcluded: rel => excluded.has(rel),
      resolveWinnerContent: rel => {
        const resolution = layers.resolveTemplateSource(rel, composeOpts)
        return resolution.winner === undefined
          ? undefined
          : readFileSafe(layers.layerAbsPath(resolution.winner, rel))
      },
    }
  } catch {
    return undefined
  }
}

export const check = editGuard(async (filePath, _content, payload) => {
  // Convention guard — stand down outside a fleet repo (also gated by the
  // defineHook scope) where the operator can't even self-authorize a bypass.
  if (!isFleetTarget(payload)) {
    return undefined
  }
  const repoRoot = findWheelhouseRoot(filePath)
  if (!repoRoot) {
    // Not the wheelhouse (no template/base). A member hand-editing a cascaded
    // file is no-fleet-fork-guard's concern, not this guard's.
    return undefined
  }
  const deps = await loadDeps(repoRoot)
  if (!deps) {
    return undefined
  }
  // Compare the FULL post-edit text (Write content, or the on-disk file with the
  // Edit / MultiEdit folded in) so an Edit fragment never false-positives.
  const postEditText = resolveEditedText(payload)
  if (!isWheelhouseControlledDrift(filePath, postEditText, repoRoot, deps)) {
    return undefined
  }
  const rel = normalizePath(filePath).slice(normalizePath(repoRoot).length + 1)
  return block(
    [
      '🚨 wheelhouse-drift-guard: refusing to edit a wheelhouse-controlled root',
      `   copy — ${rel}`,
      '',
      'This file is byte-controlled: the cascade + the GitHub-Release bundle both',
      'ship it from `template/base`. Editing the root copy drifts it from that',
      'canonical source (the next cascade overwrites your edit, or the wheelhouse',
      'ships a root copy that disagrees with template/base).',
      '',
      `Fix: edit \`template/base/${rel}\` instead, then re-cascade:`,
      '       node scripts/repo/sync.mts',
      '     Detail: docs/agents.md/fleet/wheelhouse-controlled-drift.md.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['wheelhouse-drift'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
