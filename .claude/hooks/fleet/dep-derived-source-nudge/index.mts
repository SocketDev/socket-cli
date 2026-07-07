#!/usr/bin/env node
// Claude Code PostToolUse(Edit/Write) hook — dep-derived-source-nudge.
//
// When an edit touches a MANIFEST's dependency surface — `package.json`
// dependencies/devDependencies/overrides, or `pnpm-workspace.yaml`
// catalog/overrides/minimumReleaseAgeExclude — two things must happen before
// landing: (1) regenerate the lockfile (`pnpm i` or `pnpm i --lockfile-only`)
// so `pnpm install --frozen-lockfile` passes in CI, and (2) update the CANONICAL
// SOURCES several CI gates derive from:
//   • soak-exclude parity ← scripts/repo/sync-scaffolding/manifest/release-age-annotations.mts
//   • cross-major dedup    ← .config/repo/reviewed-duplicates.json
//   • catalog              ← scripts/repo/sync-scaffolding/manifest/catalog.mts (+ pnpm-workspace.fleet.yaml)
//
// Forgetting either step trips CI separately — a multi-round-trip trap. This
// nudges both at the same moment (the manifest edit) so neither is forgotten.
//
// PostToolUse, notify only — never blocks, always exits 0. No bypass phrase.

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

// The two manifests whose dependency surface feeds the derived gates.
const MANIFEST_BASENAMES: ReadonlySet<string> = new Set([
  'package.json',
  'pnpm-workspace.yaml',
])

// package.json dependency signal: a `*Dependencies`/`overrides` block key, OR a
// `"name": "<spec>"` line whose value is a version-ish spec (semver range,
// `catalog:`/`npm:`/`workspace:` protocol, a bare `1.`, or `*`). Keeps a
// scripts-only or metadata-only edit from firing.
const PKG_DEP_RE =
  /"(?:dependencies|devDependencies|optionalDependencies|peerDependencies|overrides)"\s*:|"[\w@./-]+"\s*:\s*"(?:[\^~]|>=?|\d+\.|catalog:|npm:|workspace:|\*)/

// pnpm-workspace.yaml dependency signal: a dep section key
// (catalog / overrides / minimumReleaseAgeExclude), a soak/override list bullet
// (`- 'name@ver'`), or a catalog/override entry (`'name': <spec>`).
const WS_DEP_RE =
  /\b(?:catalog|overrides|minimumReleaseAgeExclude)\b|^\s*-\s*'[^']+'|^\s*'[\w@./-]+'\s*:\s*['"\d]/m

/**
 * True when an Edit/Write to `package.json` or `pnpm-workspace.yaml` changed
 * its dependency surface (the part the soak/dedup/catalog gates derive from).
 * Pure + exported so the detection is unit-testable without a hook payload.
 */
export function touchesManifestDeps(
  filePath: string,
  content: string | undefined,
): boolean {
  if (!content) {
    return false
  }
  const base = path.basename(normalizePath(filePath))
  if (!MANIFEST_BASENAMES.has(base)) {
    return false
  }
  return base === 'package.json'
    ? PKG_DEP_RE.test(content)
    : WS_DEP_RE.test(content)
}

export const check = editGuard((filePath, content) => {
  if (!touchesManifestDeps(filePath, content)) {
    return undefined
  }
  return notify(
    [
      `[dep-derived-source-nudge] ${path.basename(filePath)} deps changed — regenerate the lockfile and update derived sources before landing:`,
      '  • lockfile        → run `pnpm i` (or `pnpm i --lockfile-only`) so `pnpm install --frozen-lockfile` passes in CI',
      '  • soak-exclude   → scripts/repo/sync-scaffolding/manifest/release-age-annotations.mts (check-fleet-soak-exclude-parity)',
      '  • cross-major dup → .config/repo/reviewed-duplicates.json (dependencies-are-deduped)',
      '  • catalog         → scripts/repo/sync-scaffolding/manifest/catalog.mts + pnpm-workspace.fleet.yaml',
      '  Then run `pnpm run check` before pushing to catch all of them at once.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  scope: 'convention',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
