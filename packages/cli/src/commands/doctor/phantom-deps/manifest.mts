/**
 * Parse a package's `package.json` into (a) its DECLARED dependency surface -
 * the sets a specifier is checked against - and (b) its published entry
 * points, the roots of the reachable-module walk.
 *
 * Ported from nub's `nub-phantom-scan::manifest` (jdx/nub, MIT), with one
 * simplification: `devDependencies` are not tracked at all, since the
 * type-surface classifier no longer gates on a declared `@types/<pkg>` twin.
 * See classify.mts for why - a type-only reference needs nothing at runtime
 * regardless of where its types come from.
 */

export type EntryKind = 'main' | 'subpath' | 'types'

export interface Entry {
  path: string
  kind: EntryKind
}

export interface EntrySeen {
  seen: Set<string>
}

export interface Manifest {
  name: string
  /**
   * `dependencies` ∪ `optionalDependencies` - hard-declared, always resolvable.
   */
  deps: Set<string>
  /**
   * Required peers (`peerDependencies` without an `optional` meta flag).
   */
  requiredPeers: Set<string>
  /**
   * Optional peers (`peerDependenciesMeta.<x>.optional === true`).
   */
  optionalPeers: Set<string>
  /**
   * `bundledDependencies` / `bundleDependencies`.
   */
  bundled: Set<string>
  entryPoints: Entry[]
}

const JS_EXTS = new Set(['cjs', 'cts', 'js', 'jsx', 'mjs', 'mts', 'ts', 'tsx'])
const SFC_EXTS = new Set(['astro', 'svelte', 'vue'])

export function collectBundled(
  pkg: Record<string, unknown>,
  out: Set<string>,
): void {
  const fields = ['bundledDependencies', 'bundleDependencies']
  for (let i = 0, { length } = fields; i < length; i += 1) {
    const arr = pkg[fields[i]!]
    if (Array.isArray(arr)) {
      for (let j = 0, jlen = arr.length; j < jlen; j += 1) {
        const item = arr[j]
        if (typeof item === 'string') {
          out.add(item)
        }
      }
    }
  }
}

export function collectEntryPoints(pkg: Record<string, unknown>): Entry[] {
  const seen: EntrySeen = { seen: new Set() }
  const out: Entry[] = []

  collectMainEntries(pkg, out, seen)
  collectTypeEntries(pkg, out, seen)
  return out
}

export function collectExportTypes(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (let i = 0, { length } = node; i < length; i += 1) {
      collectExportTypes(node[i], out)
    }
    return
  }
  if (typeof node === 'object' && node !== null) {
    const entries = Object.entries(node as Record<string, unknown>)
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const { 0: key, 1: child } = entries[i]!
      if ((key === 'types' || key === 'typings') && typeof child === 'string') {
        out.push(child)
      } else {
        collectExportTypes(child, out)
      }
    }
  }
}

export function collectKeys(
  value: Record<string, unknown> | undefined,
  out: Set<string>,
): void {
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value)
    for (let i = 0, { length } = keys; i < length; i += 1) {
      out.add(keys[i]!)
    }
  }
}

export function collectMainEntries(
  pkg: Record<string, unknown>,
  out: Entry[],
  seen: EntrySeen,
): void {
  const mainFields = ['main', 'module']
  for (let i = 0, { length } = mainFields; i < length; i += 1) {
    const value = pkg[mainFields[i]!]
    if (typeof value === 'string') {
      pushEntry(value, 'main', out, seen)
    }
  }

  collectManifestBin(pkg['bin'], out, seen)
  const exportsField = pkg['exports']
  collectManifestExports(exportsField, out, seen)

  ensureMainEntry(out)
}

export function collectManifestBin(
  bin: unknown,
  out: Entry[],
  seen: EntrySeen,
): void {
  const values =
    typeof bin === 'string'
      ? [bin]
      : typeof bin === 'object' && bin !== null
        ? Object.values(bin as Record<string, unknown>)
        : []
  for (let i = 0, { length } = values; i < length; i += 1) {
    const value = values[i]
    if (typeof value === 'string') {
      pushEntry(value, 'main', out, seen)
    }
  }
}

export function collectManifestExports(
  exportsField: unknown,
  out: Entry[],
  seen: EntrySeen,
): void {
  if (typeof exportsField === 'string') {
    walkExports(exportsField, 'main', out, seen)
    return
  }
  if (
    typeof exportsField !== 'object' ||
    exportsField === null ||
    Array.isArray(exportsField)
  ) {
    return
  }
  const entries = Object.entries(exportsField as Record<string, unknown>)
  if (!entries.some(({ 0: key }) => key.startsWith('.'))) {
    walkExports(exportsField, 'main', out, seen)
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const { 0: key, 1: child } = entries[i]!
    walkExports(child, key === '.' ? 'main' : 'subpath', out, seen)
  }
}

export function collectManifestTypes(
  pkg: Record<string, unknown>,
  exportsField: unknown,
  entries: Entry[],
): string[] {
  const targets: string[] = []
  for (const field of ['types', 'typings']) {
    const value = pkg[field]
    if (typeof value === 'string') {
      targets.push(value)
    }
  }
  if (exportsField) {
    collectExportTypes(exportsField, targets)
  }
  if (targets.length === 0) {
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      if (entry.kind === 'main') {
        targets.push(entry.path)
      }
    }
    targets.push('index.d.ts')
  }
  return targets
}

export function collectTypeEntries(
  pkg: Record<string, unknown>,
  out: Entry[],
  seen: EntrySeen,
): void {
  const exportsField = pkg['exports']

  const typeTargets = collectManifestTypes(pkg, exportsField, out)
  for (let i = 0, { length } = typeTargets; i < length; i += 1) {
    pushEntry(typeTargets[i]!, 'types', out, seen)
  }
}

export function ensureMainEntry(out: Entry[]): void {
  if (out.length === 0) {
    out.push({ kind: 'main', path: 'index.js' })
  }
}

export function extensionOf(filePath: string): string | undefined {
  const file = filePath.slice(filePath.lastIndexOf('/') + 1)
  const dot = file.lastIndexOf('.')
  return dot <= 0 ? undefined : file.slice(dot + 1)
}

export function isDtsLike(filePath: string): boolean {
  return (
    filePath.endsWith('.d.ts') ||
    filePath.endsWith('.d.mts') ||
    filePath.endsWith('.d.cts')
  )
}

export function isEntryCandidate(filePath: string): boolean {
  return (
    isJsLike(filePath) ||
    isSfcLike(filePath) ||
    isDtsLike(filePath) ||
    extensionOf(filePath) === undefined
  )
}

export function isJsLike(filePath: string): boolean {
  if (isDtsLike(filePath)) {
    return false
  }
  const ext = extensionOf(filePath)
  return ext !== undefined && JS_EXTS.has(ext)
}

export function isSfcLike(filePath: string): boolean {
  const ext = extensionOf(filePath)
  return ext !== undefined && SFC_EXTS.has(ext)
}

export function normalizeRel(p: string): string {
  let out = p
  if (out.startsWith('./')) {
    out = out.slice(2)
  }
  if (out.startsWith('/')) {
    out = out.slice(1)
  }
  return out
}

/**
 * Parse from raw `package.json` text. Returns `undefined` when unparseable or
 * nameless.
 */
export function parseManifest(raw: string): Manifest | undefined {
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
  const name = pkg['name']
  if (typeof name !== 'string' || !name) {
    return undefined
  }

  const deps = new Set<string>()
  collectKeys(pkg['dependencies'] as Record<string, unknown> | undefined, deps)
  collectKeys(
    pkg['optionalDependencies'] as Record<string, unknown> | undefined,
    deps,
  )

  const requiredPeers = new Set<string>()
  collectKeys(
    pkg['peerDependencies'] as Record<string, unknown> | undefined,
    requiredPeers,
  )

  const optionalPeers = new Set<string>()
  const peerMeta = pkg['peerDependenciesMeta']
  if (typeof peerMeta === 'object' && peerMeta !== null) {
    const entries = Object.entries(peerMeta as Record<string, unknown>)
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const { 0: peer, 1: cfg } = entries[i]!
      const optional =
        typeof cfg === 'object' &&
        cfg !== null &&
        (cfg as Record<string, unknown>)['optional'] === true
      if (optional) {
        requiredPeers.delete(peer)
        optionalPeers.add(peer)
      }
    }
  }

  const bundled = new Set<string>()
  collectBundled(pkg, bundled)

  return {
    bundled,
    deps,
    entryPoints: collectEntryPoints(pkg),
    name,
    optionalPeers,
    requiredPeers,
  }
}

export function pushEntry(
  raw: string,
  kind: EntryKind,
  out: Entry[],
  seen: EntrySeen,
): void {
  const norm = normalizeRel(raw)
  const key = `${kind}:${norm}`
  if (isEntryCandidate(norm) && !seen.seen.has(key)) {
    seen.seen.add(key)
    out.push({ kind, path: norm })
  }
}

/**
 * Recursively collect every relative-path leaf of an `exports` subtree,
 * carrying the surface `kind` down. Skips `types`/`typings` (handled by
 * collectExportTypes).
 */
export function walkExports(
  node: unknown,
  kind: EntryKind,
  out: Entry[],
  seen: EntrySeen,
): void {
  if (typeof node === 'string') {
    pushEntry(node, kind, out, seen)
    return
  }
  if (Array.isArray(node)) {
    for (let i = 0, { length } = node; i < length; i += 1) {
      walkExports(node[i], kind, out, seen)
    }
    return
  }
  if (typeof node === 'object' && node !== null) {
    const entries = Object.entries(node as Record<string, unknown>)
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const { 0: key, 1: child } = entries[i]!
      if (key === 'types' || key === 'typings') {
        continue
      }
      walkExports(child, kind, out, seen)
    }
  }
}
