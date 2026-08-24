/**
 * Walk the module graph reachable from a package's PUBLISHED entry points,
 * collecting the bare-specifier occurrences seen along the way.
 *
 * Restricting to reachable files is what keeps a `devDependencies`-only
 * import in a test/example file (never referenced by `exports`/`main`/`bin`)
 * from being mistaken for a phantom: those files are simply never reached.
 *
 * Ported from nub's `nub-phantom-scan::graph` (jdx/nub, MIT), scoped to the
 * filesystem-backed walk only. nub's CAS-index variant and single-file-
 * component resolution are specific to nub's own package-linking pipeline
 * and do not apply to scanning an already-installed `node_modules` tree.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { extract } from './extract.mts'
import { isDtsLike, isJsLike } from './manifest.mts'
import { classifySpecifier } from './specifier.mts'

import type { Entry } from './manifest.mts'

export interface Reference {
  package: string
  raw: string
  soft: boolean
  fromMain: boolean
  fromSubpath: boolean
  fromTypes: boolean
}

export interface Surface {
  readonly preferDts: boolean
}

export interface Walk {
  references: Reference[]
  filesAnalyzed: number
}

const FROM_MAIN = 0b001
const FROM_SUBPATH = 0b010
const FROM_TYPES = 0b100

/**
 * Caps a pathological package's walk; real published entry graphs are far
 * smaller.
 */
const MAX_FILES = 6000
/**
 * Bounds `main`-chasing recursion against a self-referential `package.json`.
 */
const MAX_RESOLVE_DEPTH = 16

const JS_EXTS = ['cjs', 'cts', 'js', 'jsx', 'mjs', 'mts', 'ts', 'tsx']
const DTS_EXTS = ['d.cts', 'd.mts', 'd.ts']

export function addFlags(
  flags: Map<string, number>,
  key: string,
  bit: number,
): boolean {
  const before = flags.get(key) ?? 0
  const after = before | bit
  flags.set(key, after)
  return after !== before
}

/**
 * On the type surface, TS resolves a `./widgets.js` re-export's TYPES at
 * `./widgets.d.ts` - strip any runtime/declaration extension so the `.d.ts`
 * ladder re-appends the declaration form.
 */
export function dtsStem(spec: string): string {
  const exts = [
    '.d.ts',
    '.d.mts',
    '.d.cts',
    '.js',
    '.cjs',
    '.mjs',
    '.jsx',
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
  ]
  for (let i = 0, { length } = exts; i < length; i += 1) {
    const ext = exts[i]!
    if (spec.endsWith(ext)) {
      return spec.slice(0, -ext.length)
    }
  }
  return spec
}

export function fsResolve(
  root: string,
  fromDir: string,
  spec: string,
  surface: Surface,
  depth: number,
): string | undefined {
  if (depth > MAX_RESOLVE_DEPTH) {
    return undefined
  }
  const stemmed = surface.preferDts ? dtsStem(spec) : spec
  const joined = path.resolve(fromDir, stemmed)
  const rel = path.relative(root, joined)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return undefined
  }
  const exts = surface.preferDts ? DTS_EXTS : JS_EXTS

  if (!surface.preferDts && isResolvableFile(joined, surface)) {
    return joined
  }
  for (let i = 0, { length } = exts; i < length; i += 1) {
    const candidate = `${joined}.${exts[i]}`
    if (isResolvableFile(candidate, surface)) {
      return candidate
    }
  }
  for (let i = 0, { length } = exts; i < length; i += 1) {
    const candidate = path.join(joined, `index.${exts[i]}`)
    if (isResolvableFile(candidate, surface)) {
      return candidate
    }
  }
  const pkgJsonPath = path.join(joined, 'package.json')
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<
        string,
        unknown
      >
      const entry = manifestEntry(pkg, surface)
      if (entry) {
        return fsResolve(root, joined, entry, surface, depth + 1)
      }
    } catch {
      // Unreadable/invalid package.json - fall through to the index default.
    }
    for (let i = 0, { length } = exts; i < length; i += 1) {
      const candidate = path.join(joined, `index.${exts[i]}`)
      if (isResolvableFile(candidate, surface)) {
        return candidate
      }
    }
  }
  return undefined
}

export function isResolvableFile(p: string, surface: Surface): boolean {
  if (!existsSync(p)) {
    return false
  }
  return surface.preferDts ? isDtsLike(p) : isJsLike(p)
}

export function manifestEntry(
  pkg: Record<string, unknown>,
  surface: Surface,
): string | undefined {
  const fields = surface.preferDts ? ['types', 'typings'] : ['main']
  for (let i = 0, { length } = fields; i < length; i += 1) {
    const value = pkg[fields[i]!]
    if (typeof value === 'string') {
      return value
    }
  }
  return undefined
}

/**
 * Walk from `entryPoints` inside `root` (an already-extracted/installed
 * package directory), following relative edges and collecting bare
 * references. Each reachable file accumulates a provenance mask; a bare
 * reference inherits its file's final mask.
 */
export function walk(root: string, entryPoints: readonly Entry[]): Walk {
  const parsed = new Map<string, ReturnType<typeof extract>>()
  const flags = new Map<string, number>()
  const queue: string[] = []

  for (let i = 0, { length } = entryPoints; i < length; i += 1) {
    const entry = entryPoints[i]!
    const surface: Surface = { preferDts: entry.kind === 'types' }
    const resolved = fsResolve(root, root, entry.path, surface, 0)
    if (!resolved) {
      continue
    }
    const bit =
      entry.kind === 'main'
        ? FROM_MAIN
        : entry.kind === 'subpath'
          ? FROM_SUBPATH
          : FROM_TYPES
    if (addFlags(flags, resolved, bit)) {
      queue.push(resolved)
    }
  }

  while (queue.length > 0) {
    const file = queue.shift()!
    const fflags = flags.get(file) ?? 0
    if (!parsed.has(file)) {
      if (parsed.size >= MAX_FILES) {
        continue
      }
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      parsed.set(file, extract(file, text))
    }
    const occurrences = parsed.get(file)!
    const targets: string[] = []
    for (let i = 0, { length } = occurrences; i < length; i += 1) {
      const occ = occurrences[i]!
      if (classifySpecifier(occ.spec).kind === 'relative') {
        const surface: Surface = { preferDts: isDtsLike(file) }
        const resolved = fsResolve(
          root,
          path.dirname(file),
          occ.spec,
          surface,
          0,
        )
        if (resolved) {
          targets.push(resolved)
        }
      }
    }
    for (let i = 0, { length } = targets; i < length; i += 1) {
      const target = targets[i]!
      if (addFlags(flags, target, fflags)) {
        queue.push(target)
      }
    }
  }

  const references: Reference[] = []
  for (const [file, occurrences] of parsed) {
    const fflags = flags.get(file) ?? 0
    for (let i = 0, { length } = occurrences; i < length; i += 1) {
      const occ = occurrences[i]!
      const spec = classifySpecifier(occ.spec)
      if (spec.kind === 'bare') {
        references.push({
          fromMain: (fflags & FROM_MAIN) !== 0,
          fromSubpath: (fflags & FROM_SUBPATH) !== 0,
          fromTypes: (fflags & FROM_TYPES) !== 0 || occ.typeOnly,
          package: spec.packageName,
          raw: occ.spec,
          soft: occ.soft,
        })
      }
    }
  }

  return { filesAnalyzed: parsed.size, references }
}
