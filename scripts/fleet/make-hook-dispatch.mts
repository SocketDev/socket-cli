#!/usr/bin/env node
/*
 * @file Generate the STATIC hook dispatch table the rolldown bundle is built
 *   from. The dispatcher (`_dispatch/dispatch.mts`) can't use a dynamic
 *   `import(path.join(HOOKS_DIR, rel))` — a dynamic specifier is opaque to the
 *   bundler, so nothing would get bundled. This maker scans
 *   `.claude/hooks/fleet/<name>/index.mts`, keeps only the hooks that are
 *   BUNDLE-SAFE (entrypoint-guarded so importing them doesn't fire `main()`,
 *   AND exporting a pure `run(payload)`), and writes
 *   `.claude/hooks/fleet/_dispatch/dispatch-table.mts`: one STATIC `import` per
 *   eligible hook, grouped by hook event. Re-run after adding/removing an
 *   eligible hook, then rebuild the bundle (`build-hook-bundle.mts`).
 *
 *   Eligibility is decided by reading each hook's source for two markers:
 *     - the entrypoint call `void runHook(hook, import.meta.url)` (importing the
 *       hook does NOT fire `main()` — `runHook` is a no-op unless the module is
 *       the process entrypoint)
 *     - `export const hook = defineHook(` — the `defineHook` contract export the
 *       dispatcher runs via its `check` seam without a dynamic import
 *   The hook's `event` (default 'PreToolUse') and tool `matcher` are read
 *   statically from the `defineHook({ … })` call.
 *
 *   Usage: `node scripts/fleet/make-hook-dispatch.mts [--check]`
 *     --check  exit 2 if the on-disk table differs from freshly generated.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
} from './paths.mts'

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
} from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const ENTRYPOINT_GUARD_RE =
  /\bvoid\s+runHook\s*\(\s*hook\s*,\s*import\.meta\.url/
const EXPORT_HOOK_RE = /export\s+const\s+hook\s*=\s*defineHook\s*\(/
// Snapshot-hostility opt-out: a hook whose module-eval graph holds native
// state V8 refuses to serialize (an SDK client binding node:http's
// HTTPParser, module-eval semver construction, …) declares
// `@dispatch-snapshot-exclude` in its header. It stays in the FULL table
// (index.cjs path) but is split out of the snapshot bundle into
// `excluded-bundle.cjs`, which deserialize-main splices in at runtime.
const SNAPSHOT_EXCLUDE_RE = /@dispatch-snapshot-exclude\b/
const DISPATCH_EVENT_RE = /\bevent\s*:\s*['"]([^'"]+)['"]/
const DISPATCH_TOOLS_RE = /\bmatcher\s*:\s*\[([^\]]*)\]/

export interface EligibleHook {
  readonly event: string
  readonly name: string
  readonly snapshotExcluded: boolean
  readonly tools: readonly string[]
  readonly triggers: readonly string[]
}

const EXPORT_TRIGGERS_RE = /\bexport\s+const\s+triggers\b/
const INLINE_TRIGGERS_RE = /\btriggers\s*:\s*\[/

/**
 * Index just before the `triggers` array literal a hook declares, or -1 when it
 * declares none. Two forms: `export const triggers[: type] = [ … ]` (referenced
 * by shorthand in defineHook — return the index of its `=`, so the caller's
 * `indexOf('[')` skips the `[` in a `readonly string[]` annotation) or an
 * inline `triggers: [ … ]` property (return the index of its `[`).
 */
function findTriggersArrayStart(source: string): number {
  const exportMatch = EXPORT_TRIGGERS_RE.exec(source)
  if (exportMatch) {
    return source.indexOf('=', exportMatch.index + exportMatch[0].length)
  }
  const inlineMatch = INLINE_TRIGGERS_RE.exec(source)
  if (inlineMatch) {
    return inlineMatch.index + inlineMatch[0].length - 1
  }
  return -1
}

/**
 * Extract the quoted-string tokens of a hook's `triggers` array in declared
 * order (`[]` when none). Scans for the array's matching `]` while honoring
 * quoted strings, so a token that itself contains a `]` (the OSC-52 `]52;`
 * clipboard trigger) does not end the array early. Tokens may hold other
 * special chars (`(`, `=`) and either quote style.
 */
export function parseTriggers(source: string): string[] {
  const start = findTriggersArrayStart(source)
  if (start === -1) {
    return []
  }
  const open = source.indexOf('[', start)
  if (open === -1) {
    return []
  }
  const tokens: string[] = []
  let quote = ''
  let token = ''
  for (let i = open + 1, { length } = source; i < length; i += 1) {
    const ch = source[i]!
    if (quote) {
      if (ch === '\\') {
        token += source[i + 1] ?? ''
        i += 1
        continue
      }
      if (ch === quote) {
        tokens.push(token)
        token = ''
        quote = ''
        continue
      }
      token += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      token = ''
      continue
    }
    if (ch === ']') {
      break
    }
  }
  return tokens
}

/**
 * Parse a hook's source for the eligibility markers + optional event/tools/
 * triggers declarations. Returns the eligible-hook descriptor, or undefined
 * when the hook is not bundle-safe.
 */
export function parseHookSource(
  name: string,
  source: string,
): EligibleHook | undefined {
  if (!ENTRYPOINT_GUARD_RE.test(source) || !EXPORT_HOOK_RE.test(source)) {
    return undefined
  }
  const eventMatch = DISPATCH_EVENT_RE.exec(source)
  const event = eventMatch?.[1] ?? 'PreToolUse'
  const toolsMatch = DISPATCH_TOOLS_RE.exec(source)
  const tools = toolsMatch?.[1]
    ? toolsMatch[1]
        .split(',')
        // Strip a leading or trailing single/double quote from each token.
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    : []
  return {
    __proto__: null,
    event,
    name,
    snapshotExcluded: SNAPSHOT_EXCLUDE_RE.test(source),
    tools,
    triggers: parseTriggers(source),
  } as EligibleHook
}

/**
 * Scan the fleet hooks dir, returning every bundle-safe hook sorted by name.
 */
export function collectEligibleHooks(hooksDir: string): EligibleHook[] {
  const entries = readdirSync(hooksDir, { withFileTypes: true })
  const eligible: EligibleHook[] = []
  for (const dirent of entries) {
    if (!dirent.isDirectory()) {
      continue
    }
    const name = dirent.name
    if (name.startsWith('_')) {
      continue
    }
    const indexPath = path.join(hooksDir, name, 'index.mts')
    let source: string
    try {
      source = readFileSync(indexPath, 'utf8')
    } catch {
      continue
    }
    const parsed = parseHookSource(name, source)
    if (parsed) {
      eligible.push(parsed)
    }
  }
  eligible.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return eligible
}

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
    `// GENERATED by scripts/fleet/make-hook-dispatch.mts — do not edit by hand.\n` +
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
      const groupHooks = [...byMatcher.get(matcher)!].sort((a, b) =>
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
            `  node scripts/fleet/make-hook-dispatch.mts`,
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
          '  Fix:   node scripts/fleet/make-hook-dispatch.mts',
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
