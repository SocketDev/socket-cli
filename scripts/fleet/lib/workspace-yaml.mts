/**
 * @file Fleet-canonical pnpm-workspace.yaml string helpers. Pure functions —
 *   no FS reads, no side effects. All parsing is line-anchored to preserve
 *   hand-written comments (a proper YAML round-trip would drop them).
 *   Exported from here (the fleet-canonical home) and re-exported by
 *   scripts/repo/sync-scaffolding/manifest/catalog.mts +
 *   scripts/repo/sync-scaffolding/fix-workspace-yaml-splicers.mts for
 *   back-compat with their existing importers.
 */

/**
 * Parse a named block of `<key>: <value>` entries from a pnpm-workspace.yaml
 * string. Defaults to the `catalog:` block; pass `options.blockKey` to target
 * another block (e.g. `'catalogOptional'` or `'overrides'`).
 *
 * Returns `{ '<name>': '<version-or-alias-spec>' }`. Tolerant of quoted vs
 * unquoted keys and trailing comments.
 */
export function parseCatalogBlock(
  content: string,
  options?: { blockKey?: string | undefined } | undefined,
): Record<string, string> {
  const opts = Object.assign(Object.create(null) as Record<string, string>, {
    blockKey: 'catalog',
    ...options,
  }) as { blockKey: string }
  const blockHeader = `${opts.blockKey}:`
  const out: Record<string, string> = {}
  const lines = content.split('\n')
  let inBlock = false
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i]!
    if (ln.trimEnd() === blockHeader) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    if (ln === '' || (ln.length > 0 && !/^\s/.test(ln))) {
      break
    }
    const m =
      // Parse a key: value line with optional surrounding quotes and trailing comment.
      // `^\s*` — leading whitespace; `['"]?` — optional opening quote;
      // `([^'":]+)` — group 1: key chars (no quote/colon); `['"]?` — optional closing quote;
      // `\s*:\s*` — colon separator with optional spaces;
      // `['"]?([^'"#\s]+)['"]?` — group 2: unquoted value (no quote/hash/space);
      // `\s*(?:#.*)?$` — optional trailing comment to end of line.
      /^\s*['"]?([^'":]+)['"]?\s*:\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(ln)
    if (m?.[1] && m[2]) {
      out[m[1]] = m[2]
    }
  }
  return out
}

/**
 * Parse the `packages:` list (or any `- 'value'` bullet block) from a
 * pnpm-workspace.yaml string. Handles single-quoted, double-quoted, and
 * unquoted values. Negation patterns (leading `!`) are returned as-is.
 * Comment lines are skipped.
 */
export function parseListBlock(
  content: string,
  config: { blockKey: string },
): string[] {
  const cfg = Object.assign(Object.create(null), config) as {
    blockKey: string
  }
  const blockHeader = `${cfg.blockKey}:`
  const results: string[] = []
  const lines = content.split('\n')
  let inBlock = false
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i]!
    if (ln.trimEnd() === blockHeader) {
      inBlock = true
      continue
    }
    if (!inBlock) {
      continue
    }
    if (ln === '' || (ln.length > 0 && !/^\s/.test(ln))) {
      break
    }
    const trimmed = ln.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    // Match `- 'value'`, `- "value"`, or `- value` (with optional trailing comment).
    const m = /^-\s*['"]?([^'"#\n]+?)['"]?\s*(?:#.*)?$/.exec(trimmed)
    if (m?.[1]) {
      results.push(m[1].trim())
    }
  }
  return results
}

/**
 * Parse the `catalogs:` block (named catalogs) from a pnpm-workspace.yaml
 * string. Returns a two-level map: `{ '<catalogName>': { '<dep>': '<version>'
 * } }`. Used for diagnosis only — named-catalog refs that have no matching
 * sub-block are reported as unfixable.
 */
export function parseNamedCatalogs(
  content: string,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  const lines = content.split('\n')
  let inCatalogsBlock = false
  let currentName: string | undefined
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i]!
    if (ln.trimEnd() === 'catalogs:') {
      inCatalogsBlock = true
      currentName = undefined
      continue
    }
    if (!inCatalogsBlock) {
      continue
    }
    // Top-level key ends the catalogs block.
    if (ln.length > 0 && !/^\s/.test(ln)) {
      break
    }
    if (ln === '') {
      continue
    }
    // Two-space indent = named catalog sub-key, e.g. `  react17:`
    const subKeyMatch = /^ {2}['"]?([^'":]+)['"]?\s*:$/.exec(ln)
    if (subKeyMatch?.[1]) {
      currentName = subKeyMatch[1]
      result[currentName] = {}
      continue
    }
    // Four-space indent = entry under the current named catalog.
    if (currentName !== undefined) {
      const entryMatch =
        /^ {4}['"]?([^'":]+)['"]?\s*:\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(
          ln,
        )
      if (entryMatch?.[1] && entryMatch[2]) {
        result[currentName]![entryMatch[1]] = entryMatch[2]
      }
    }
  }
  return result
}

/**
 * Insert `'<name>': <version>` into the `catalog:` block, sorted
 * alphabetically. Creates the block if absent.
 */
export function spliceCatalogEntry(
  content: string,
  name: string,
  version: string,
): string {
  const newLine = `  '${name}': ${version}`
  const lines = content.split('\n')
  const catalogIdx = lines.findIndex(line => line.trimEnd() === 'catalog:')

  if (catalogIdx === -1) {
    return `catalog:\n${newLine}\n\n${content}`
  }

  // Walk the block: each entry starts with leading whitespace and
  // contains `:`. Stop at a blank line, EOF, or a top-level key.
  let end = catalogIdx + 1
  while (end < lines.length) {
    const ln = lines[end]
    if (ln === undefined) {
      break
    }
    if (ln === '' || (ln.length > 0 && !/^\s/.test(ln))) {
      break
    }
    end += 1
  }
  const blockLines = lines.slice(catalogIdx + 1, end)
  // Entry already present (drift bump): rewrite the value in place, keeping
  // the original line's whitespace + key quoting. No-op if already current.
  const needle = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const dupRe = new RegExp(`^\\s*['"]?${needle}['"]?\\s*:`)
  const existingIdx = blockLines.findIndex(line => dupRe.test(line))
  if (existingIdx !== -1) {
    const existing = blockLines[existingIdx]!
    const rewritten = existing.replace(/(:\s*).*$/, `$1${version}`)
    if (rewritten === existing) {
      return content
    }
    const next = [...lines]
    next[catalogIdx + 1 + existingIdx] = rewritten
    return next.join('\n')
  }
  // Insert alphabetically by package name. Existing entries may be
  // quoted (`'@types/node':`) or bare (`micromark:`); compare on the
  // un-quoted name.
  const nameOf = (line: string): string => {
    const m = /^\s*['"]?([^'":]+)['"]?\s*:/.exec(line)
    return m ? m[1]! : ''
  }
  const target = name
  let insertAt = catalogIdx + 1
  for (let i = 0; i < blockLines.length; i += 1) {
    if (target.localeCompare(nameOf(blockLines[i]!)) < 0) {
      insertAt = catalogIdx + 1 + i
      break
    }
    insertAt = catalogIdx + 1 + i + 1
  }
  const next = [...lines]
  next.splice(insertAt, 0, newLine)
  return next.join('\n')
}

/**
 * Remove the `'<name>': <version>` entry from the `catalog:` block, keyed on
 * the NAME only — any version/spec matches, quoted or bare. No-op when the
 * block or the entry is absent.
 */
export function removeCatalogEntry(content: string, name: string): string {
  const lines = content.split('\n')
  const catalogIdx = lines.findIndex(line => line.trimEnd() === 'catalog:')
  if (catalogIdx === -1) {
    return content
  }
  let end = catalogIdx + 1
  while (end < lines.length) {
    const ln = lines[end]
    if (ln === undefined || ln === '' || (ln.length > 0 && !/^\s/.test(ln))) {
      break
    }
    end += 1
  }
  const needle = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const entryRe = new RegExp(`^\\s*['"]?${needle}['"]?\\s*:`)
  const idx = lines.findIndex(
    (line, i) => i > catalogIdx && i < end && entryRe.test(line),
  )
  if (idx === -1) {
    return content
  }
  const next = [...lines]
  next.splice(idx, 1)
  return next.join('\n')
}
