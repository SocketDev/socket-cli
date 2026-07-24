#!/usr/bin/env node
/*
 * @file Generate the STATIC hook dispatch table the rolldown bundle is built
 *   from. The dispatcher (`_dispatch/dispatch.mts`) can't use a dynamic
 *   `import(path.join(HOOKS_DIR, rel))` — a dynamic specifier is opaque to the
 *   bundler, so nothing would get bundled. This maker scans
 *   `.claude/hooks/fleet/<name>/index.mts` (via `collectEligibleHooks` in
 *   `_shared/dispatch-scan.mts`), keeps only the hooks that are BUNDLE-SAFE
 *   (entrypoint-guarded so importing them doesn't fire `main()`, AND exporting a
 *   pure `run(payload)`), and writes
 *   `.claude/hooks/fleet/_dispatch/dispatch-table.mts`: one STATIC `import` per
 *   eligible hook, grouped by hook event. Re-run after adding/removing an
 *   eligible hook, then rebuild the bundle (`build-hook-bundle.mts`).
 *
 *   Usage: `node scripts/fleet/gen/hook-dispatch.mts [--check]`
 *     --check  exit 2 if the on-disk table differs from freshly generated.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  DISPATCH_MANIFEST_PATH,
  DISPATCH_TABLE_EXCLUDED_PATH,
  DISPATCH_TABLE_PATH,
  DISPATCH_TABLE_SNAPSHOT_PATH,
  FLEET_HOOKS_DIR,
  REPO_ROOT,
} from '../paths.mts'
import type { EligibleHook } from '../_shared/dispatch-scan.mts'
import { collectEligibleHooks } from '../_shared/dispatch-scan.mts'
import { hasFleetHookSource } from '../_shared/fleet-source-present.mts'

const logger = getDefaultLogger()

// Dispatch + bundle paths are owned by paths.mts (1 path, 1 reference);
// re-export them so existing consumers keep importing them from this module.
export {
  DISPATCH_DIR,
  DISPATCH_ENTRY_PATH,
  DISPATCH_MANIFEST_PATH,
  DISPATCH_TABLE_PATH,
  FLEET_HOOKS_DIR,
  HOOK_BUNDLE_PATH,
  resolveHookBundleOut,
} from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

/**
 * Render the dispatch-table.mts source from the eligible-hook list. Each hook
 * gets a STATIC import (so rolldown bundles it) and a table row keyed by event.
 */
export type TableVariant = 'excluded' | 'full' | 'snapshot'

const VARIANT_BANNER: Record<TableVariant, string> = {
  __proto__: null,
  excluded:
    '// Snapshot-EXCLUDED hooks only (@dispatch-snapshot-exclude): bundled to\n' +
    '// excluded-bundle.cjs and spliced in by deserialize-main at runtime.',
  full: '// Static dispatch table: every bundle-safe fleet hook, grouped by event.',
  snapshot:
    '// Snapshot-SAFE hooks only (no @dispatch-snapshot-exclude): the set frozen\n' +
    '// into the V8 startup snapshot. EXCLUDED_HOOK_HINTS names the event→tools\n' +
    '// surface of the split-out hooks so deserialize-main loads\n' +
    '// excluded-bundle.cjs only when a dispatch could need it.',
} as Record<TableVariant, string>

/**
 * The event→tools surface of the snapshot-excluded hooks: `null` for an event
 * with an any-tool excluded hook, else the deduped tool union. Frozen into
 * the snapshot table so deserialize-main can skip loading the excluded
 * bundle for irrelevant dispatches.
 */
export function renderExcludedHints(excluded: readonly EligibleHook[]): string {
  const byEvent = new Map<string, Set<string> | null>()
  for (const hook of excluded) {
    const prior = byEvent.get(hook.event)
    if (prior === null) {
      continue
    }
    if (hook.tools.length === 0) {
      // null is a tri-state sentinel distinct from Map#get's own
      // undefined-for-absent-key, and mirrors the emitted
      // `readonly string[] | null` EXCLUDED_HOOK_HINTS contract.
      // oxlint-disable-next-line socket/prefer-undefined-over-null -- see above
      byEvent.set(hook.event, null)
      continue
    }
    const set = prior ?? new Set<string>()
    for (const tool of hook.tools) {
      set.add(tool)
    }
    byEvent.set(hook.event, set)
  }
  const events = [...byEvent.keys()].toSorted()
  const rows = events.map(event => {
    const tools = byEvent.get(event)
    const literal =
      tools === null || tools === undefined
        ? 'null'
        : `[${[...tools]
            .toSorted()
            .map(t => `'${t}'`)
            .join(', ')}]`
    return `  '${event}': ${literal},`
  })
  return (
    `export const EXCLUDED_HOOK_HINTS: Record<\n` +
    `  string,\n` +
    `  readonly string[] | null\n` +
    `> = {\n` +
    `  __proto__: null,\n` +
    (rows.length ? rows.join('\n') + '\n' : '') +
    `} as Record<string, readonly string[] | null>\n`
  )
}

export function renderDispatchTable(
  hooks: readonly EligibleHook[],
  variant: TableVariant = 'full',
  allHooks: readonly EligibleHook[] = hooks,
): string {
  const importLines = hooks.map(
    (h, i) => `import { hook as hook${i} } from '../${h.name}/index.mts'`,
  )
  const byEvent = new Map<string, Array<{ idx: number; hook: EligibleHook }>>()
  for (let idx = 0, { length } = hooks; idx < length; idx += 1) {
    const hook = hooks[idx]!
    const list = byEvent.get(hook.event) ?? []
    list.push({ hook, idx })
    byEvent.set(hook.event, list)
  }
  const events = [...byEvent.keys()].toSorted()
  const tableBody = events
    .map(event => {
      const rows = byEvent
        .get(event)!
        .map(({ hook, idx }) => {
          const toolsLiteral = hook.tools.length
            ? `[${hook.tools.map(t => `'${t}'`).join(', ')}]`
            : 'undefined'
          return `    { name: '${hook.name}', check: hook${idx}.check, tools: ${toolsLiteral} },`
        })
        .join('\n')
      return `  '${event}': [\n${rows}\n  ],`
    })
    .join('\n')
  // Every variant exports the hints: dispatch-snapshot-entry imports them
  // through './dispatch-table.mts', which resolves to the FULL table outside
  // the snapshot build (dev runs, type-checking) and to the snapshot variant
  // inside it — the export must exist in both.
  const hints =
    '\n' + renderExcludedHints(allHooks.filter(h => h.snapshotExcluded))
  return (
    `// GENERATED by scripts/fleet/gen/hook-dispatch.mts — do not edit by hand.\n` +
    VARIANT_BANNER[variant] +
    `\n` +
    `// Re-run the maker after adding/removing an eligible hook, then rebuild\n` +
    `// the bundle with scripts/fleet/build-hook-bundle.mts.\n` +
    `\n` +
    `import type { DispatchHookEntry } from './dispatch.mts'\n` +
    `\n` +
    (importLines.length ? importLines.join('\n') + '\n\n' : '\n') +
    `export const DISPATCH_TABLE: Record<string, readonly DispatchHookEntry[]> = {\n` +
    `  __proto__: null,\n` +
    (tableBody ? tableBody + '\n' : '') +
    `} as Record<string, readonly DispatchHookEntry[]>\n` +
    hints
  )
}

export function generateDispatchTableSource(
  hooksDir: string,
  variant: TableVariant = 'full',
): string {
  const all = collectEligibleHooks(hooksDir)
  const subset =
    variant === 'full'
      ? all
      : all.filter(h => h.snapshotExcluded === (variant === 'excluded'))
  return renderDispatchTable(subset, variant, all)
}

export type ManifestHookEntry =
  | string
  | { readonly path: string; readonly triggers: readonly string[] }

export interface ManifestGroup {
  readonly matcher: string
  readonly hooks: readonly ManifestHookEntry[]
}

export type DispatchManifestShape = Record<string, readonly ManifestGroup[]>

/**
 * Render the dep-0 dispatch manifest the bootstrap dispatcher (`_shared/
 * dispatch.mts`) routes off. Keyed by EVENT; each event is an array of `{
 * matcher, hooks }` groups. `matcher` is `tools.join('|')` in DECLARED order
 * (`''` for a no-tool event like Stop/SessionStart), so two hooks whose tool
 * arrays differ only in order land in DISTINCT groups. A hook with no triggers
 * is the bare path string; one with triggers is `{ path, triggers }`. Ordering
 * is canonical + deterministic: events sorted, matcher groups sorted by
 * matcher, hooks sorted by name within a group. Output matches
 * JSON.stringify(_, null, 2) plus a trailing newline (the committed manifest's
 * byte shape).
 */
export function renderDispatchManifest(hooks: readonly EligibleHook[]): string {
  const byEvent = new Map<string, Map<string, EligibleHook[]>>()
  for (let i = 0, { length } = hooks; i < length; i += 1) {
    const hook = hooks[i]!
    const matcher = hook.tools.join('|')
    let byMatcher = byEvent.get(hook.event)
    if (!byMatcher) {
      byMatcher = new Map<string, EligibleHook[]>()
      byEvent.set(hook.event, byMatcher)
    }
    const list = byMatcher.get(matcher)
    if (list) {
      list.push(hook)
    } else {
      byMatcher.set(matcher, [hook])
    }
  }
  const events = [...byEvent.keys()].toSorted()
  const entries = events.map((event): [string, ManifestGroup[]] => {
    const byMatcher = byEvent.get(event)!
    const matchers = [...byMatcher.keys()].toSorted()
    const groups: ManifestGroup[] = matchers.map(matcher => {
      const groupHooks = [...byMatcher.get(matcher)!].toSorted((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )
      const hookEntries: ManifestHookEntry[] = groupHooks.map(hook => {
        const rel = `fleet/${hook.name}/index.mts`
        return hook.triggers.length
          ? { path: rel, triggers: [...hook.triggers] }
          : rel
      })
      return { matcher, hooks: hookEntries }
    })
    return [event, groups]
  })
  // Object.fromEntries preserves the sorted insertion order for JSON.stringify.
  const manifest: DispatchManifestShape = Object.fromEntries(entries)
  return `${JSON.stringify(manifest, undefined, 2)}\n`
}

export function generateDispatchManifestSource(hooksDir: string): string {
  return renderDispatchManifest(collectEligibleHooks(hooksDir))
}

export const TABLE_OUTPUTS: ReadonlyArray<readonly [TableVariant, string]> = [
  ['full', DISPATCH_TABLE_PATH],
  ['snapshot', DISPATCH_TABLE_SNAPSHOT_PATH],
  ['excluded', DISPATCH_TABLE_EXCLUDED_PATH],
]

function main(): void {
  // A bundle-only member has no per-hook SOURCE dirs — a regen over the absent
  // dirs renders EMPTY tables + manifest and overwrites the release-shipped
  // full ones (and --check would false-fail comparing empty-vs-shipped). The
  // dispatch artifacts are built + validated at the source repo.
  if (!hasFleetHookSource(REPO_ROOT)) {
    logger.log(
      '[gen/hook-dispatch] no fleet hook source (bundle-only) — dispatch artifacts ship via the release bundle.',
    )
    return
  }
  const checkOnly = process.argv.includes('--check')
  if (checkOnly) {
    for (const [variant, outPath] of TABLE_OUTPUTS) {
      const generated = generateDispatchTableSource(FLEET_HOOKS_DIR, variant)
      let onDisk = ''
      try {
        onDisk = readFileSync(outPath, 'utf8')
      } catch {
        onDisk = ''
      }
      if (onDisk !== generated) {
        logger.error(
          `${path.basename(outPath)} is stale. Regenerate:\n` +
            `  node scripts/fleet/gen/hook-dispatch.mts`,
        )
        process.exitCode = 2
        return
      }
    }
    const manifestGenerated = generateDispatchManifestSource(FLEET_HOOKS_DIR)
    let manifestOnDisk = ''
    try {
      manifestOnDisk = readFileSync(DISPATCH_MANIFEST_PATH, 'utf8')
    } catch {
      manifestOnDisk = ''
    }
    if (manifestOnDisk !== manifestGenerated) {
      logger.error(
        'dispatch-manifest.json is stale (the dep-0 bootstrap dispatcher routes\n' +
          `  off it, so a stale manifest leaves hooks silently inert on that path).\n` +
          `  Where: ${path.relative(REPO_ROOT, DISPATCH_MANIFEST_PATH)}\n` +
          '  Saw:   the committed manifest differs from a regen over the current hook dirs.\n' +
          '  Fix:   node scripts/fleet/gen/hook-dispatch.mts',
      )
      process.exitCode = 2
      return
    }
    logger.log('dispatch tables + manifest are current.')
    return
  }
  for (const [variant, outPath] of TABLE_OUTPUTS) {
    writeFileSync(
      outPath,
      generateDispatchTableSource(FLEET_HOOKS_DIR, variant),
    )
  }
  writeFileSync(
    DISPATCH_MANIFEST_PATH,
    generateDispatchManifestSource(FLEET_HOOKS_DIR),
  )
  // Dogfood: the wheelhouse carries template/base/ (a member does not). Mirror
  // the generated full table + manifest into the template so its CI readers +
  // the release-bundle walk find them — both are gitignored + never committed,
  // so a fresh checkout has none. Computed relative to REPO_ROOT so this file
  // stays cascade-safe (no wheelhouse-only imports). Pure JS (no rolldown), so
  // it runs cross-platform in CI setup where build-hook-bundle's native rolldown
  // spawn does not.
  const templateDispatch = path.join(
    REPO_ROOT,
    'template/base/.claude/hooks/fleet/_dispatch',
  )
  if (existsSync(templateDispatch)) {
    writeFileSync(
      path.join(templateDispatch, 'dispatch-table.mts'),
      generateDispatchTableSource(FLEET_HOOKS_DIR),
    )
    writeFileSync(
      path.join(
        REPO_ROOT,
        'template/base/.claude/hooks/fleet/_shared/dispatch-manifest.json',
      ),
      generateDispatchManifestSource(FLEET_HOOKS_DIR),
    )
  }
  const all = collectEligibleHooks(FLEET_HOOKS_DIR)
  const excluded = all.filter(h => h.snapshotExcluded).length
  logger.log(
    `Wrote ${path.relative(REPO_ROOT, DISPATCH_TABLE_PATH)} (+snapshot/excluded variants) ` +
      `+ ${path.relative(REPO_ROOT, DISPATCH_MANIFEST_PATH)}: ` +
      `${all.length} bundle-safe hook${all.length === 1 ? '' : 's'}, ${excluded} snapshot-excluded.`,
  )
}

if (isMainModule(import.meta.url)) {
  main()
}
