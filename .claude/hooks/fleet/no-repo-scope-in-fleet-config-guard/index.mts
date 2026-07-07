#!/usr/bin/env node
// Claude Code PreToolUse hook — no-repo-scope-in-fleet-config-guard.
//
// Blocks an Edit/Write that adds a ONE-REPO path-scope into a fleet-canonical
// config under `template/.config/fleet/`. The fleet tier is for rules that
// apply to EVERY member; a concern specific to one repo's tree (e.g.
// socket-registry's `packages/npm/**` vendored reimplementations) belongs in
// THAT repo's own `.config/repo/` overlay, never the wheelhouse fleet config.
//
// The detectable invariant (verified against the current fleet oxlintrc: all
// 106 globs satisfy it): every path-glob in a fleet config's `overrides[].files`
// or `ignorePatterns` is UNIVERSAL — it starts with `**/` (applies in every
// repo regardless of layout) or is a bare extension pattern (`*.ts`) or a
// managed marker (`#…`). A glob that names a concrete repo-specific subtree
// (`packages/npm/**`, `src/foo/**` without the `**/` anchor) is the violation:
// it silently makes one repo's exception fleet-wide.
//
// Catches the Edit/Write BEFORE it lands; pairs with no-fleet-fork-guard (which
// guards the INVERSE — editing a canonical file downstream). No overlap: that
// guards downstream edits; this guards repo-scope leaking INTO the fleet tier.
//
// Bypass: `Allow repo-scope-in-fleet bypass` typed verbatim in a recent turn —
// for the rare case a path genuinely applies fleet-wide but can't be `**/`
// anchored.
//
// Fails open on any parse/payload error (a guard bug must not block work).

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'

import { resolveEditedText } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

const BYPASS_PHRASE = 'Allow repo-scope-in-fleet bypass'

// Fleet config basenames whose `overrides[].files` / `ignorePatterns` globs
// must be universal. (oxfmtrc has no overrides today, but guard it too so a
// future repo-scope addition is caught.)
const GUARDED_BASENAMES = new Set([
  'oxfmtrc.json',
  'oxlintrc.dogfood.json',
  'oxlintrc.json',
])

// A glob is universal when it applies in every member regardless of repo
// layout: `**/`-anchored, a bare extension pattern (`*.ts`), or a managed
// marker line (`#fleet-canonical-begin …`). Anything else names a concrete
// subtree and is repo-specific.
export function isUniversalGlob(glob: string): boolean {
  const g = glob.trim()
  if (!g) {
    return true
  }
  return g.startsWith('**/') || g.startsWith('*.') || g.startsWith('#')
}

// Collect every path-glob from a parsed oxlint/oxfmt config's override + ignore
// surfaces. Tolerant of missing keys / shapes (returns what it finds).
export function collectConfigGlobs(parsed: unknown): string[] {
  const out: string[] = []
  if (!parsed || typeof parsed !== 'object') {
    return out
  }
  const obj = parsed as {
    overrides?: unknown | undefined
    ignorePatterns?: unknown | undefined
  }
  if (Array.isArray(obj.overrides)) {
    for (const ov of obj.overrides) {
      const files = (ov as { files?: unknown | undefined })?.files
      if (Array.isArray(files)) {
        for (const f of files) {
          if (typeof f === 'string') {
            out.push(f)
          }
        }
      }
    }
  }
  if (Array.isArray(obj.ignorePatterns)) {
    for (const p of obj.ignorePatterns) {
      if (typeof p === 'string') {
        out.push(p)
      }
    }
  }
  return out
}

// The repo-specific globs in `jsonText` (empty when all are universal or the
// text doesn't parse — fail-open).
export function repoSpecificGlobs(jsonText: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return []
  }
  return collectConfigGlobs(parsed).filter(g => !isUniversalGlob(g))
}

// True when the path is a guarded fleet config (under template/.config/fleet/
// or a live .config/fleet/, basename in the guarded set).
export function isGuardedFleetConfig(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join('/')
  if (!normalized.includes('/.config/fleet/')) {
    return false
  }
  return GUARDED_BASENAMES.has(path.basename(filePath))
}

export const check = editGuard((filePath, content, payload) => {
  if (!isGuardedFleetConfig(filePath)) {
    return undefined
  }
  const afterText = resolveEditedText(payload)
  if (afterText === undefined) {
    return undefined
  }

  // Only flag globs the edit INTRODUCES (present in after, absent before) so a
  // pre-existing entry doesn't block an unrelated edit.
  const before = new Set(repoSpecificGlobs(safeReadFileSync(filePath) ?? ''))
  const introduced = repoSpecificGlobs(afterText).filter(g => !before.has(g))
  if (!introduced.length) {
    return undefined
  }
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  return block(
    `[no-repo-scope-in-fleet-config-guard] repo-specific path-scope in a fleet config:\n` +
      `  File: ${filePath}\n` +
      `  Repo-specific glob(s): ${introduced.join(', ')}\n` +
      `  Fleet configs apply to EVERY member, so a path-glob must be universal\n` +
      `  (start with \`**/\`, or be a bare extension like \`*.ts\`). A glob naming one\n` +
      `  repo's tree (e.g. \`packages/npm/**\`) makes that repo's exception fleet-wide.\n` +
      `  Fix: put the override in THAT repo's own \`.config/repo/\` overlay instead.\n` +
      `  Bypass: type "${BYPASS_PHRASE}" if the path genuinely applies fleet-wide.`,
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
