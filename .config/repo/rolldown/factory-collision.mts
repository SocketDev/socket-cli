/*
 * @file Rolldown plugins guarding the nested-bundle factory-collision class:
 *   when a build re-bundles a file that is ITSELF a bundler output — a
 *   pre-bundled dependency such as socket-lib's `dist/external/npm-pack.js` —
 *   that file carries pre-suffixed CJS factory bindings like `require_node$2`.
 *   Rolldown's identifier deconflicter appends its own `$N` suffixes when the
 *   outer graph has a colliding name, and a generated name can land on a
 *   DIFFERENT factory's pre-existing name in the same emitted scope: two
 *   `var require_node$2 = __commonJS(…)` declarations, the later silently
 *   clobbering the earlier, so an unrelated binding resolves to the wrong
 *   module at runtime. Motivating incidents: socket-cli's dlx install crash —
 *   Arborist's `pacote` rebound to libnpmpack via a colliding `require_lib$10`
 *   — and socket-packageurl-js's `dist/exists.js` require-time crash, where
 *   the npmcli-fs version helper was clobbered by Arborist's `Node` class and
 *   `node.satisfies` stopped being a function.
 *   Two independent guards, adopt either or both:
 *
 *   - `createPrebundleRenamePlugin` — the FIX, ported from socket-cli's proven
 *     rolldown.cli.mts mechanics. Rewrites the pre-suffixed `require_*$N`
 *     factory names inside matching pre-bundled files to a `$`-free form the
 *     deconflicter can never generate, and realpath-normalizes resolved ids so
 *     a symlink-aliased prebundle — pnpm's `@socketsecurity/lib` + `lib-stable`
 *     aliases point at one real package — can't enter the module graph twice
 *     and force the deconflict in the first place.
 *   - `createCollisionDetectorPlugin` — the BACKSTOP. A post-render check that
 *     fails the build when any emitted chunk declares the same `var require_*`
 *     binding twice in one scope. Cheap: a regex pass filters chunks that can't
 *     collide; only suspects pay for the scope-aware AST scan. Wire it even
 *     where the rename plugin isn't adopted — a silent wrong-module rebinding
 *     is strictly worse than a red build.
 */

import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

import { parseAst } from 'rolldown/parseAst'

import type { Plugin } from 'rolldown'

type AstNode = Record<string, unknown>

/**
 * Collapse a symlinked path to its physical form. Custom `resolveId` hooks
 * that compute package paths by hand — the socket-cli shape — must return
 * realpath-normalized ids, or the same physical prebundle enters the graph
 * under two ids and gets bundled twice. Unresolvable / virtual ids pass
 * through unchanged.
 */
export function toRealPath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * Rewrite pre-suffixed `require_*$N` factory names to a `$`-free form
 * (`require_lib$36` → `require_lib_v36`). The names are file-internal — a
 * bundler output never imports another file's factory bindings — so a pure
 * text rewrite is safe. Deterministic and collision-checked: every occurrence
 * of one original maps to one target, and a target that already exists as a
 * `require_*` token in the file gets `_` appended until free.
 */
export function renameFactorySuffixes(code: string): string {
  const taken = new Set<string>()
  for (const m of code.matchAll(/\brequire_\w+\b/g)) {
    taken.add(m[0])
  }
  const targets = new Map<string, string>()
  return code.replace(
    // `\b` word boundary, group 1: `require_` + letter/underscore start + word
    // chars, the factory base name, then a literal `$`, group 2: one or more
    // digits, the deconflicter-appended numeric suffix, then `\b` boundary.
    /\b(require_[A-Za-z_]\w*)\$(\d+)\b/g,
    (whole, base: string, n: string) => {
      let target = targets.get(whole)
      if (target === undefined) {
        target = `${base}_v${n}`
        while (taken.has(target)) {
          target += '_'
        }
        taken.add(target)
        targets.set(whole, target)
      }
      return target
    },
  )
}

export type PrebundleRenameConfig = {
  /**
   * Regex matched against resolved module ids. Files matching are treated as
   * pre-bundled dependencies and get their `require_*$N` factory names
   * rewritten. Anchor it to the prebundle dist tree, e.g.
   * `/[/\\]@socketsecurity[/\\]lib(?:-stable)?[/\\]dist[/\\].*\.js$/`.
   * Required.
   */
  readonly prebundlePattern: RegExp
  /**
   * Realpath-normalize every absolute resolved id so symlink-aliased paths
   * collapse to one module. Defaults to true; place this plugin FIRST in the
   * `plugins` array so the hook sees every resolution. Opt out only when the
   * build depends on symlink identity.
   */
  readonly realpathIds?: boolean | undefined
}

/**
 * Build the fix plugin: realpath-normalized module ids + `$`-free factory
 * renames inside matching pre-bundled files.
 */
export function createPrebundleRenamePlugin(
  config: PrebundleRenameConfig,
): Plugin {
  const { prebundlePattern, realpathIds = true } = {
    __proto__: null,
    ...config,
  } as PrebundleRenameConfig
  return {
    name: 'prebundle-factory-rename',
    load(id) {
      // Strip any query suffix before touching the filesystem.
      const cleanPath = id.split('?')[0] ?? id
      if (!prebundlePattern.test(cleanPath)) {
        return undefined
      }
      let code: string
      try {
        code = readFileSync(cleanPath, 'utf8')
      } catch {
        // Virtual / unreadable id — leave it to the main pipeline.
        return undefined
      }
      if (!/\brequire_[A-Za-z_]\w*\$\d+\b/.test(code)) {
        return undefined
      }
      return { code: renameFactorySuffixes(code) }
    },
    ...(realpathIds
      ? {
          // socket-lint: allow bag-param-optionality-naming -- mirrors
          // rolldown's resolveId hook signature; the third positional arg IS
          // rolldown's resolve options, not a fleet options bag.
          async resolveId(source, importer, options) {
            const resolved = await this.resolve(source, importer, {
              ...options,
              skipSelf: true,
            })
            if (
              !resolved ||
              resolved.external ||
              !path.isAbsolute(resolved.id)
            ) {
              return resolved ?? undefined
            }
            const real = toRealPath(resolved.id)
            return real === resolved.id ? resolved : { ...resolved, id: real }
          },
        }
      : {}),
  }
}

export type FactoryCollision = {
  /**
   * 1-based line of the LATER, clobbering declaration in the chunk.
   */
  readonly line: number
  readonly name: string
}

// Scope boundaries `var` hoists to. Emitted chunks are plain JS, so class
// static blocks are the only non-function var boundary that matters.
const FUNCTION_SCOPE_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'StaticBlock',
])

/**
 * Scope-aware scan for the collision signature: the same `require_*` name
 * `var`-declared WITH an initializer two or more times in one function scope
 * — the later declaration clobbers the earlier factory. Shadowing across
 * scopes is legal output and never reported. Cheap pre-filter: no name that
 * fails a whole-text duplicate count can collide, so clean chunks skip the
 * parse entirely.
 */
export function findFactoryCollisions(code: string): FactoryCollision[] {
  const counts = new Map<string, number>()
  let suspect = false
  for (const m of code.matchAll(/\bvar\s+(require_[A-Za-z_$][\w$]*)\s*=/g)) {
    const name = m[1]!
    const n = (counts.get(name) ?? 0) + 1
    counts.set(name, n)
    if (n > 1) {
      suspect = true
    }
  }
  if (!suspect) {
    return []
  }
  let program: AstNode
  try {
    program = parseAst(code, { lang: 'js' }) as unknown as AstNode
  } catch {
    // Unparseable chunk — the main pipeline surfaces the real error.
    return []
  }
  const collisions: FactoryCollision[] = []
  const seen = new Set<string>()
  let nextScope = 1
  const walk = (node: unknown, scopeId: number): void => {
    if (!node || typeof node !== 'object') {
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child, scopeId)
      }
      return
    }
    const n = node as AstNode
    const childScope = FUNCTION_SCOPE_TYPES.has(n['type'] as string)
      ? nextScope++
      : scopeId
    if (n['type'] === 'VariableDeclaration' && n['kind'] === 'var') {
      for (const d of (n['declarations'] as AstNode[] | undefined) ?? []) {
        const id = d['id'] as AstNode | undefined
        if (
          d['type'] !== 'VariableDeclarator' ||
          id?.['type'] !== 'Identifier' ||
          !d['init']
        ) {
          continue
        }
        const name = id['name'] as string
        if (!name.startsWith('require_')) {
          continue
        }
        // Only names the pre-filter saw twice can collide — skip the rest.
        if ((counts.get(name) ?? 0) < 2) {
          continue
        }
        const key = `${scopeId}\0${name}`
        if (seen.has(key)) {
          collisions.push({
            line: lineOf(code, d['start'] as number),
            name,
          })
        } else {
          seen.add(key)
        }
      }
    }
    const keys = Object.keys(n)
    for (let i = 0, { length } = keys; i < length; i += 1) {
      const key = keys[i]!
      if (key === 'end' || key === 'start' || key === 'type') {
        continue
      }
      walk(n[key], childScope)
    }
  }
  walk(program, 0)
  return collisions
}

function lineOf(code: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i += 1) {
    if (code.charCodeAt(i) === 10) {
      line += 1
    }
  }
  return line
}

/**
 * Build the backstop plugin: fail the build when any emitted chunk carries a
 * same-scope duplicate `var require_*` declaration.
 */
export function createCollisionDetectorPlugin(): Plugin {
  return {
    name: 'factory-collision-detector',
    generateBundle(_options, bundle) {
      const failures: string[] = []
      const fileNames = Object.keys(bundle)
      for (let f = 0, { length } = fileNames; f < length; f += 1) {
        const fileName = fileNames[f]!
        const asset = bundle[fileName]
        if (!asset || asset.type !== 'chunk') {
          continue
        }
        const collisions = findFactoryCollisions(asset.code)
        for (let i = 0, { length } = collisions; i < length; i += 1) {
          const c = collisions[i]!
          failures.push(
            `${fileName}: var ${c.name} redeclared at line ${c.line}`,
          )
        }
      }
      if (failures.length > 0) {
        throw new Error(
          'factory-collision-detector: duplicate CJS factory declarations in one emitted scope — ' +
            'the later declaration clobbers the earlier and rebinds its consumers to the wrong module at runtime. ' +
            'This is the nested-prebundle collision class; fix it by wiring createPrebundleRenamePlugin ' +
            'from .config/repo/rolldown/factory-collision.mts over the pre-bundled dependency, or stub the ' +
            `unreachable subgraph.\n  ${failures.join('\n  ')}`,
        )
      }
    },
  }
}
