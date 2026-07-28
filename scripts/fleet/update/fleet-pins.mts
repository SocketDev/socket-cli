/**
 * @file Fleet-pin lockstep for the update engine. The taze passes bump the
 *   LIVE `pnpm-workspace.yaml`, but a fleet-canonical pin's version source of
 *   truth is the wheelhouse template — the `catalog:` / `catalogOptional:`
 *   blocks of `template/base/.config/fleet/pnpm-workspace.fleet.yaml` plus the
 *   `FLEET_CANONICAL_OVERRIDES` pin manifest
 *   (`scripts/repo/sync-scaffolding/manifest/catalog-overrides.mts`). A bump
 *   written only to the live file loses at the next cascade: the template
 *   splices the old version straight back (svgo, vite, iconv-lite, lru-cache,
 *   string-width all bounced this way). These helpers mirror every fleet-owned
 *   bump into the canonical files in the same update wave so the update engine
 *   and the cascade agree. All transforms are line-anchored string surgery on
 *   the version token only — comments, quoting, and layout survive untouched
 *   (same discipline as lib/stable-alias.mts). Pure planners + thin fs
 *   appliers; the appliers skip absent files, so member repos (no `template/`
 *   tree, no sync-scaffolding manifest) degrade to refreshing their cascaded
 *   fleet-catalog copy only.
 */

import { existsSync, readFileSync } from 'node:fs'

import { escapeRegExp } from '@socketsecurity/lib-stable/regexps/escape'
import { gt } from '@socketsecurity/lib-stable/versions/compare'
import { isValidVersion } from '@socketsecurity/lib-stable/versions/parse'

import { parseCatalogBlock } from '../lib/workspace-yaml.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'

/**
 * The canonical block a fleet pin lives in: a fleet-catalog block of the
 * `.fleet.yaml` template, or the override-pin manifest.
 */
export type FleetPinBlockKey = 'catalog' | 'catalogOptional' | 'overrides'

/**
 * One fleet-owned pin whose live value moved ahead of its canonical value —
 * the canonical file must be rewritten to the live value.
 */
export interface FleetPinMirror {
  readonly blockKey: FleetPinBlockKey
  readonly canonicalValue: string
  readonly liveValue: string
  readonly name: string
}

/**
 * One fleet-owned pin whose live value differs from canonical but must NOT be
 * mirrored: `not-newer` (the canonical side is already at or past the live
 * version — the cascade owns that direction) or `unversioned` (a value with no
 * extractable version, e.g. `catalog:`; never guess).
 */
export interface FleetPinSkip {
  readonly blockKey: FleetPinBlockKey
  readonly canonicalValue: string
  readonly liveValue: string
  readonly name: string
  readonly reason: 'not-newer' | 'unversioned'
}

/**
 * A lockstep plan: the pins to mirror into the canonical file and the differing
 * pins deliberately left alone, surfaced so the operator sees them.
 */
export interface FleetPinPlan {
  readonly mirrors: FleetPinMirror[]
  readonly skips: FleetPinSkip[]
}

/**
 * One canonical file reconciled on disk: the path plus what was mirrored and
 * what was skipped.
 */
export interface FleetPinFileResult {
  readonly file: string
  readonly mirrored: FleetPinMirror[]
  readonly skipped: FleetPinSkip[]
}

// A `<key>: <value>` entry line inside an indented YAML block. Key may be
// quoted; value may be quoted (alias/protocol specs) or bare, a version;
// a trailing `# comment` is tolerated. Comment-only lines never match (the
// leading char of the key can't be `#` — callers skip them explicitly too).
const BLOCK_ENTRY_RE =
  /^\s*['"]?([^'"#:][^'":]*)['"]?\s*:\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/

// A `npm:<target>@<version>` alias value. `<target>` may itself be scoped
// (`@scope/name`), so the version split anchors on the LAST `@`.
const NPM_ALIAS_RE = /^npm:(.+)@([^@]+)$/

// A top-level (column-0, non-comment) key line — the only thing that ends a
// block for `parseWorkspaceBlock`. Blank lines and indented comments do NOT
// end it: the live `overrides:` block legitimately holds a blank line between
// its fleet-canonical and repo-specific sections, which is exactly why
// `parseCatalogBlock` (blank-line-terminated, matching the contiguous
// canonical file) cannot parse the live file's blocks.
const TOP_LEVEL_KEY_RE = /^\S/

/**
 * Parse a named `<key>: <value>` block from a LIVE pnpm-workspace.yaml into a
 * name → value map. Unlike `parseCatalogBlock`, a blank line does not end the
 * block — only a column-0 key does — because live blocks (e.g. `overrides:`)
 * carry blank-line-separated sections. Pure.
 */
export function parseWorkspaceBlock(
  text: string,
  blockKey: string,
): Map<string, string> {
  const header = `${blockKey}:`
  const out = new Map<string, string>()
  const lines = text.split('\n')
  let inBlock = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.trimEnd() === header) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    if (line !== '' && TOP_LEVEL_KEY_RE.test(line)) {
      break
    }
    if (line === '' || line.trimStart().startsWith('#')) {
      continue
    }
    const m = BLOCK_ENTRY_RE.exec(line)
    if (m?.[1] && m[2]) {
      out.set(m[1].trim(), m[2])
    }
  }
  return out
}

/**
 * Extract the comparable version from a pin value: a bare semver version
 * yields itself, a `npm:<target>@<version>` alias yields its pinned version,
 * anything else (`catalog:`, `workspace:*`, ranges) yields `undefined`. Pure.
 */
export function pinnedVersionOf(value: string): string | undefined {
  if (isValidVersion(value)) {
    return value
  }
  const alias = NPM_ALIAS_RE.exec(value)
  if (alias && isValidVersion(alias[2]!)) {
    return alias[2]!
  }
  return undefined
}

/**
 * Answer THE lockstep question: is this package's pin fleet-template-owned?
 * True when `name` appears in the `catalog:` or `catalogOptional:` block of
 * the fleet-canonical catalog text
 * (`template/base/.config/fleet/pnpm-workspace.fleet.yaml`). Parsed with the
 * same `parseCatalogBlock` the cascade's `loadExpectedCatalogEntries` uses, so
 * ownership answers can never drift from what the cascade enforces. Pure.
 */
export function isFleetTemplateOwned(
  name: string,
  canonicalYamlText: string,
): boolean {
  if (Object.hasOwn(parseCatalogBlock(canonicalYamlText), name)) {
    return true
  }
  return Object.hasOwn(
    parseCatalogBlock(canonicalYamlText, { blockKey: 'catalogOptional' }),
    name,
  )
}

/**
 * True when the live pin value should overwrite the canonical one: both carry
 * an extractable version and the live one is strictly newer. `false` = live is
 * at/behind canonical, the cascade owns that direction; `undefined` = one
 * side has no extractable version, so never guess. Pure.
 */
export function isNewerPin(
  liveValue: string,
  canonicalValue: string,
): boolean | undefined {
  const live = pinnedVersionOf(liveValue)
  const canonical = pinnedVersionOf(canonicalValue)
  if (live === undefined || canonical === undefined) {
    return undefined
  }
  return gt(live, canonical)
}

function classifyDrift(
  plan: FleetPinPlan,
  blockKey: FleetPinBlockKey,
  name: string,
  liveValue: string,
  canonicalValue: string,
): void {
  const newer = isNewerPin(liveValue, canonicalValue)
  if (newer === true) {
    plan.mirrors.push({ blockKey, canonicalValue, liveValue, name })
    return
  }
  plan.skips.push({
    blockKey,
    canonicalValue,
    liveValue,
    name,
    reason: newer === false ? 'not-newer' : 'unversioned',
  })
}

/**
 * Plan the catalog lockstep: every fleet-owned name (canonical `catalog:` /
 * `catalogOptional:` entry) whose LIVE `catalog:` value moved to a newer
 * version becomes a mirror; differing-but-not-newer or unversioned drift is
 * reported as a skip. Names absent from the live catalog are ignored. Pure.
 */
export function planFleetPinMirror(
  liveYamlText: string,
  canonicalYamlText: string,
): FleetPinPlan {
  const liveCatalog = parseWorkspaceBlock(liveYamlText, 'catalog')
  const plan: FleetPinPlan = { mirrors: [], skips: [] }
  const blockKeys: FleetPinBlockKey[] = ['catalog', 'catalogOptional']
  for (let i = 0, { length } = blockKeys; i < length; i += 1) {
    const blockKey = blockKeys[i]!
    const canonical = parseCatalogBlock(canonicalYamlText, { blockKey })
    const names = Object.keys(canonical)
    for (let j = 0, jl = names.length; j < jl; j += 1) {
      const name = names[j]!
      const liveValue = liveCatalog.get(name)
      const canonicalValue = canonical[name]!
      if (liveValue === undefined || liveValue === canonicalValue) {
        continue
      }
      classifyDrift(plan, blockKey, name, liveValue, canonicalValue)
    }
  }
  return plan
}

/**
 * Rewrite the value of one `<name>: <value>` entry inside the named block,
 * preserving indentation, key/value quoting, and any trailing comment — only
 * the value token changes. An unquoted value that becomes a spec needing
 * quotes (`:` or space) gains single quotes. Throws What/Where/Saw/Fix when
 * the block or entry is absent — a planner/rewriter disagreement must fail
 * loud, never silently no-op. Pure.
 */
export function rewriteBlockPin(
  text: string,
  blockKey: string,
  name: string,
  newValue: string,
): string {
  const header = `${blockKey}:`
  const entryRe = new RegExp(
    `^(\\s+(['"]?)${escapeRegExp(name)}\\2:[ \\t]+)(['"]?)([^'"#]+?)\\3([ \\t]*(?:#.*)?)$`,
  )
  const lines = text.split('\n')
  let inBlock = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (line.trimEnd() === header) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    if (line !== '' && TOP_LEVEL_KEY_RE.test(line)) {
      break
    }
    if (line === '' || line.trimStart().startsWith('#')) {
      continue
    }
    const m = entryRe.exec(line)
    if (!m) {
      continue
    }
    const quote = m[3]! || (/[\s:]/.test(newValue) ? "'" : '')
    lines[i] = `${m[1]}${quote}${newValue}${quote}${m[5]}`
    return lines.join('\n')
  }
  throw new Error(
    'Fleet-pin entry not found for lockstep rewrite.\n' +
      `  Where: '${name}' under '${blockKey}:'\n` +
      `  Saw: no matching entry line; wanted one '${name}: <value>' entry to retarget to ${newValue}.\n` +
      '  Fix: re-run the cascade (the canonical catalog and the live workspace have diverged structurally), then re-run `pnpm run update`.',
  )
}

/**
 * Mirror fleet-owned catalog bumps from the live `pnpm-workspace.yaml` into
 * each existing canonical catalog file IN PLACE (absent paths are skipped —
 * member repos carry no `template/` tree). Returns one result per file with
 * mirrors or skips. Idempotent: a second run finds no drift.
 */
export function applyFleetPinLockstep(
  workspaceYamlPath: string,
  canonicalYamlPaths: readonly string[],
): FleetPinFileResult[] {
  if (!existsSync(workspaceYamlPath)) {
    return []
  }
  const liveText = readFileSync(workspaceYamlPath, 'utf8')
  const results: FleetPinFileResult[] = []
  for (let i = 0, { length } = canonicalYamlPaths; i < length; i += 1) {
    const file = canonicalYamlPaths[i]!
    if (!existsSync(file)) {
      continue
    }
    let text = readFileSync(file, 'utf8')
    const { mirrors, skips } = planFleetPinMirror(liveText, text)
    for (let j = 0, jl = mirrors.length; j < jl; j += 1) {
      const m = mirrors[j]!
      text = rewriteBlockPin(text, m.blockKey, m.name, m.liveValue)
    }
    if (mirrors.length > 0) {
      writeThroughMirrorLock(file, text)
    }
    if (mirrors.length > 0 || skips.length > 0) {
      results.push({ file, mirrored: mirrors, skipped: skips })
    }
  }
  return results
}

// One override-pin literal inside the FLEET_CANONICAL_OVERRIDES object:
// `'key': 'value',` or `key: 'value',`, keys may be bare identifiers.
const OVERRIDE_LITERAL_RE =
  /^\s*(?:'([^']+)'|([$A-Za-z_][\w$-]*)):\s*'([^']*)',?\s*$/

/**
 * Parse the `FLEET_CANONICAL_OVERRIDES` object literal out of the
 * sync-scaffolding override-pin manifest source into a key → value map.
 * Line-anchored, comment lines skipped, so it never needs a TS parser. Pure.
 */
export function parseOverridePinLiterals(mtsText: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = mtsText.split('\n')
  let inObject = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!inObject) {
      if (line.includes('FLEET_CANONICAL_OVERRIDES') && line.includes('{')) {
        inObject = true
      }
      continue
    }
    if (line.trimEnd() === '}') {
      break
    }
    const trimmed = line.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
      continue
    }
    const m = OVERRIDE_LITERAL_RE.exec(line)
    if (m) {
      out.set(m[1] ?? m[2]!, m[3]!)
    }
  }
  return out
}

/**
 * Rewrite one override-pin literal's value inside `FLEET_CANONICAL_OVERRIDES`,
 * touching only the quoted value string. Throws What/Where/Saw/Fix when the
 * key is absent. Pure.
 */
export function rewriteOverridePinLiteral(
  mtsText: string,
  key: string,
  newValue: string,
): string {
  const needle = escapeRegExp(key)
  const entryRe = new RegExp(
    `^(\\s*(?:'${needle}'|${needle}):\\s*')[^']*(',?\\s*)$`,
  )
  const lines = mtsText.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = entryRe.exec(lines[i]!)
    if (m) {
      lines[i] = `${m[1]}${newValue}${m[2]}`
      return lines.join('\n')
    }
  }
  throw new Error(
    'Override-pin literal not found for lockstep rewrite.\n' +
      `  Where: FLEET_CANONICAL_OVERRIDES key '${key}'\n` +
      `  Saw: no matching literal line; wanted one \`'${key}': '<value>'\` entry to retarget to ${newValue}.\n` +
      '  Fix: align scripts/repo/sync-scaffolding/manifest/catalog-overrides.mts with the live overrides block, then re-run `pnpm run update`.',
  )
}

/**
 * Plan the override lockstep: every `FLEET_CANONICAL_OVERRIDES` key whose LIVE
 * `overrides:` value moved to a newer version becomes a mirror; `catalog:` /
 * alias-shaped drift and not-newer drift are reported as skips. Pure.
 */
export function planOverridePinMirror(
  liveYamlText: string,
  manifestText: string,
): FleetPinPlan {
  const liveOverrides = parseWorkspaceBlock(liveYamlText, 'overrides')
  const canonical = parseOverridePinLiterals(manifestText)
  const plan: FleetPinPlan = { mirrors: [], skips: [] }
  for (const [key, canonicalValue] of canonical) {
    const liveValue = liveOverrides.get(key)
    if (liveValue === undefined || liveValue === canonicalValue) {
      continue
    }
    classifyDrift(plan, 'overrides', key, liveValue, canonicalValue)
  }
  return plan
}

/**
 * Mirror fleet-canonical override bumps from the live `pnpm-workspace.yaml`
 * into the override-pin manifest IN PLACE. Returns the file result, or
 * `undefined` when either file is absent (member repos have no
 * sync-scaffolding manifest) or nothing differs.
 */
export function applyOverridePinLockstep(
  workspaceYamlPath: string,
  manifestPath: string,
): FleetPinFileResult | undefined {
  if (!existsSync(workspaceYamlPath) || !existsSync(manifestPath)) {
    return undefined
  }
  const liveText = readFileSync(workspaceYamlPath, 'utf8')
  let text = readFileSync(manifestPath, 'utf8')
  const { mirrors, skips } = planOverridePinMirror(liveText, text)
  for (let i = 0, { length } = mirrors; i < length; i += 1) {
    const m = mirrors[i]!
    text = rewriteOverridePinLiteral(text, m.name, m.liveValue)
  }
  if (mirrors.length > 0) {
    writeThroughMirrorLock(manifestPath, text)
  }
  if (mirrors.length === 0 && skips.length === 0) {
    return undefined
  }
  return { file: manifestPath, mirrored: mirrors, skipped: skips }
}
