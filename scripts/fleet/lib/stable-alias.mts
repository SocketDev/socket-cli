/**
 * @file `-stable` catalog-alias tracking. A Socket package carries two catalog
 *   entries: the floating base (`@socketsecurity/lib: 6.0.10`) and a pinned
 *   alias (`@socketsecurity/lib-stable: 'npm:@socketsecurity/lib@6.0.10'`) that
 *   code imports for a version-locked surface. The alias MUST track its base —
 *   "update <socket-pkg> = its -stable alias too" (CLAUDE.md vocabulary). When
 *   the base bumps and the alias is left behind, imports of `-stable` resolve
 *   an older build than the catalog ships. Pure text transforms over the
 *   catalog YAML (no YAML parser dep — the catalog is a flat `key: value`
 *   block), plus one thin fs applier (`applyStableAliasReconcile`) shared by
 *   the fix path and `update.mts`. The `stable-aliases-match-base` check
 *   consumes the pure `findStableAliasDesyncs` to fail loud on desync.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * A `-stable` alias whose pinned version disagrees with its base catalog entry.
 */
export interface StableAliasDesync {
  /**
   * The alias catalog key, e.g. `@socketsecurity/lib-stable`.
   */
  readonly alias: string
  /**
   * The version the alias currently pins.
   */
  readonly aliasVersion: string
  /**
   * The aliased base package, e.g. `@socketsecurity/lib`.
   */
  readonly base: string
  /**
   * The version the base catalog entry declares (what the alias should be).
   */
  readonly baseVersion: string
}

// A catalog entry line: <indent><key>: <value>. Key may be single-quoted; value
// may be single-quoted (an alias spec) or bare (a version). Captures indent (1),
// key (3, unquoted), value (5, unquoted).
const ENTRY_RE = /^(\s+)('?)(@?[\w./-]+)\2:[ \t]+('?)(.+?)\4[ \t]*$/

// An alias value: `npm:<target>@<version>`. `<target>` may itself be scoped
// (`@scope/name`), so anchor the version split on the LAST `@`.
const ALIAS_RE = /^npm:(.+)@([^@]+)$/

// A top-level block header opening the default catalog (`catalog:`). Entries
// under it are the version pins + `-stable` aliases we reconcile. A later
// top-level key (a column-0 line) ends the block — this is what keeps the
// `overrides:` / importer blocks (which carry `<name>: 'catalog:'` protocol
// refs, NOT versions) from contaminating the base-version map.
const CATALOG_HEADER_RE = /^catalog:[ \t]*$/
const TOP_LEVEL_RE = /^\S/

/**
 * Parse the default `catalog:` block's `key: value` entries into a name → value
 * map. Only that block is read — a `<name>: 'catalog:'` protocol ref under
 * `overrides:` or an importer block is NOT a version and must not shadow the
 * real pin. Pure.
 */
export function parseCatalogEntries(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = text.split('\n')
  let inCatalog = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (CATALOG_HEADER_RE.test(line)) {
      inCatalog = true
      continue
    }
    if (inCatalog && TOP_LEVEL_RE.test(line)) {
      inCatalog = false
    }
    if (!inCatalog) {
      continue
    }
    const m = ENTRY_RE.exec(line)
    if (m) {
      out.set(m[3]!, m[5]!)
    }
  }
  return out
}

/**
 * Find every `-stable` alias whose pinned version disagrees with the version
 * its base catalog entry declares. Only aliases whose base package is present
 * in the catalog with a bare version are considered (an alias to an absent or
 * itself-aliased base is out of scope). Pure.
 */
export function findStableAliasDesyncs(text: string): StableAliasDesync[] {
  const entries = parseCatalogEntries(text)
  const desyncs: StableAliasDesync[] = []
  for (const [key, value] of entries) {
    if (!key.endsWith('-stable')) {
      continue
    }
    const aliasMatch = ALIAS_RE.exec(value)
    if (!aliasMatch) {
      continue
    }
    const base = aliasMatch[1]!
    const aliasVersion = aliasMatch[2]!
    const baseVersion = entries.get(base)
    // Base absent, or itself an alias (a `npm:` value) — nothing to track.
    if (baseVersion === undefined || baseVersion.startsWith('npm:')) {
      continue
    }
    if (baseVersion !== aliasVersion) {
      desyncs.push({ alias: key, aliasVersion, base, baseVersion })
    }
  }
  return desyncs
}

/**
 * Rewrite every desynced `-stable` alias to pin its base's version. Returns the
 * updated text and the list of changes (empty when already in sync). Preserves
 * each line's original quoting + indentation — only the version token changes.
 * Pure + idempotent.
 */
export function reconcileStableAliases(text: string): {
  changed: StableAliasDesync[]
  text: string
} {
  const desyncs = findStableAliasDesyncs(text)
  if (desyncs.length === 0) {
    return { changed: [], text }
  }
  const byAlias = new Map(desyncs.map(d => [d.alias, d]))
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = ENTRY_RE.exec(lines[i]!)
    if (!m) {
      continue
    }
    const desync = byAlias.get(m[3]!)
    if (!desync) {
      continue
    }
    // Rewrite only the version token in the aliased value, preserving the
    // captured indent (1), key quote (2), and value quote (4).
    const newValue = `npm:${desync.base}@${desync.baseVersion}`
    lines[i] = `${m[1]}${m[2]}${m[3]}${m[2]}: ${m[4]}${newValue}${m[4]}`
  }
  return { changed: desyncs, text: lines.join('\n') }
}

/**
 * A catalog file reconciled on disk: the path plus the alias changes applied.
 */
export interface StableAliasFileResult {
  readonly changed: StableAliasDesync[]
  readonly file: string
}

/**
 * Reconcile `-stable` aliases across the given catalog files IN PLACE. Reads
 * each existing file, rewrites any desynced alias to its base version, and only
 * writes when something changed (no spurious mtime churn). Missing files are
 * skipped. Returns one result per file that changed. Shared by `update.mts`
 * (post-bump) and the fix path (`pnpm run fix`).
 */
export function applyStableAliasReconcile(
  files: readonly string[],
): StableAliasFileResult[] {
  const results: StableAliasFileResult[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (!existsSync(file)) {
      continue
    }
    const original = readFileSync(file, 'utf8')
    const { changed, text } = reconcileStableAliases(original)
    if (changed.length > 0 && text !== original) {
      writeFileSync(file, text)
      results.push({ changed, file })
    }
  }
  return results
}
