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

  const mainFields = ['main', 'module']
  for (let i = 0, { length } = mainFields; i < length; i += 1) {
    const value = pkg[mainFields[i]!]
    if (typeof value === 'string') {
      pushEntry(value, 'main', out, seen)
    }
  }

  const bin = pkg['bin']
  if (typeof bin === 'string') {
    pushEntry(bin, 'main', out, seen)
  } else if (typeof bin === 'object' && bin !== null) {
    const values = Object.values(bin as Record<string, unknown>)
    for (let i = 0, { length } = values; i < length; i += 1) {
      const value = values[i]
      if (typeof value === 'string') {
        pushEntry(value, 'main', out, seen)
      }
    }
  }

  const exportsField = pkg['exports']
  if (
    typeof exportsField === 'object' &&
    exportsField !== null &&
    !Array.isArray(exportsField)
  ) {
    const map = exportsField as Record<string, unknown>
    const keys = Object.keys(map)
    const hasDotKeys = keys.some(k => k.startsWith('.'))
    if (hasDotKeys) {
      const entries = Object.entries(map)
      for (let i = 0, { length } = entries; i < length; i += 1) {
        const [key, child] = entries[i]!
        walkExports(child, key === '.' ? 'main' : 'subpath', out, seen)
      }
    } else {
      walkExports(exportsField, 'main', out, seen)
    }
  } else if (typeof exportsField === 'string') {
    walkExports(exportsField, 'main', out, seen)
  }

  if (out.length === 0) {
    out.push({ kind: 'main', path: 'index.js' })
  }

  const typeTargets: string[] = []
  const typeFields = ['types', 'typings']
  for (let i = 0, { length } = typeFields; i < length; i += 1) {
    const value = pkg[typeFields[i]!]
    if (typeof value === 'string') {
      typeTargets.push(value)
    }
  }
  if (exportsField) {
    collectExportTypes(exportsField, typeTargets)
  }
  if (typeTargets.length === 0) {
    for (let i = 0, { length } = out; i < length; i += 1) {
      const entry = out[i]!
      if (entry.kind === 'main') {
        typeTargets.push(entry.path)
      }
    }
    typeTargets.push('index.d.ts')
  }
  for (let i = 0, { length } = typeTargets; i < length; i += 1) {
    pushEntry(typeTargets[i]!, 'types', out, seen)
  }

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
      const [key, child] = entries[i]!
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
      const [peer, cfg] = entries[i]!
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
      const [key, child] = entries[i]!
      if (key === 'types' || key === 'typings') {
        continue
      }
      walkExports(child, kind, out, seen)
    }
  }
}
