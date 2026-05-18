/**
 * @fileoverview Shared "is this binding a Set / Map / Iterable?"
 * heuristic used by no-cached-for-on-iterable AND by
 * prefer-cached-for-loop's skip list.
 *
 * Without TypeScript type info available to oxlint plugins, the
 * detection is AST-only:
 *
 *   - `new Set(...)` / `new Map(...)` / `new WeakSet(...)` /
 *     `new WeakMap(...)` initializer → set/map
 *   - `: Set<...>` / `: ReadonlySet<...>` / `: Map<...>` /
 *     `: ReadonlyMap<...>` / `: WeakSet<...>` / `: WeakMap<...>`
 *     annotation → set/map
 *   - `: Iterable<...>` / `: AsyncIterable<...>` /
 *     `: IterableIterator<...>` annotation → iterable
 *   - `[…]` array literal / `: T[]` / `: Array<...>` /
 *     `: ReadonlyArray<...>` / `Array.from(...)` / `Array.of(...)` /
 *     `Object.keys|values|entries(...)` → array (negative signal)
 *   - anything else → unknown (caller decides whether to skip)
 *
 * Two rules consume this:
 *
 *   1. `no-cached-for-on-iterable` — flags when a cached-length
 *      `for (let i = 0, { length } = X; …)` loop is applied to a
 *      set / map / iterable.
 *
 *   2. `prefer-cached-for-loop` — needs to SKIP rewriting
 *      `for (const item of setVar)` into the cached-length shape,
 *      because doing so produces the silent-no-op bug the other
 *      rule catches. Without this skip, the two rules race each
 *      other and the autofix re-introduces the bug.
 *
 * Both rules register the same visitors (`VariableDeclarator`,
 * `FunctionDeclaration`, `FunctionExpression`,
 * `ArrowFunctionExpression`) and share the resulting per-file map
 * via the helpers in this module.
 */

import type { AstNode } from './rule-types.mts'

const SET_TYPE_NAMES = new Set(['Set', 'ReadonlySet', 'WeakSet'])
const MAP_TYPE_NAMES = new Set(['Map', 'ReadonlyMap', 'WeakMap'])
const ITERABLE_TYPE_NAMES = new Set([
  'Iterable',
  'AsyncIterable',
  'IterableIterator',
])
const ARRAY_TYPE_NAMES = new Set(['Array', 'ReadonlyArray'])

export type Kind = 'set' | 'map' | 'iterable' | 'array' | 'unknown'

// Non-array kinds — the ones flagged by no-cached-for-on-iterable
// and the ones prefer-cached-for-loop must skip.
export const FLAGGED_KINDS: ReadonlySet<Kind> = new Set([
  'set',
  'map',
  'iterable',
])

/**
 * Classify a TS type-annotation AST node (the `: T` part of a
 * binding). Returns the kind, or `'unknown'` if the annotation is
 * absent or doesn't match a recognized shape. Shallow-only — does
 * NOT unwrap `Promise<Set<…>>` (returns unknown, which is safe).
 */
export function classifyTypeAnnotation(
  annotation: AstNode | undefined,
): Kind {
  if (!annotation || !annotation.typeAnnotation) {
    return 'unknown'
  }
  const t = annotation.typeAnnotation
  if (t.type === 'TSArrayType') {
    return 'array'
  }
  if (t.type === 'TSTypeReference') {
    const name =
      t.typeName && t.typeName.type === 'Identifier'
        ? t.typeName.name
        : undefined
    if (!name) {
      return 'unknown'
    }
    if (SET_TYPE_NAMES.has(name)) {
      return 'set'
    }
    if (MAP_TYPE_NAMES.has(name)) {
      return 'map'
    }
    if (ITERABLE_TYPE_NAMES.has(name)) {
      return 'iterable'
    }
    if (ARRAY_TYPE_NAMES.has(name)) {
      return 'array'
    }
  }
  return 'unknown'
}

/**
 * Classify the initializer expression a VariableDeclarator is bound
 * to. Recognizes `new Set(...)` / `new Map(...)` and a handful of
 * array-materializing calls (`Array.from`, `Object.keys`, etc.) so
 * the rule doesn't fire on post-fix `const arr = Array.from(set)`
 * shapes.
 */
export function classifyInit(init: AstNode | undefined): Kind {
  if (!init) {
    return 'unknown'
  }
  if (init.type === 'ArrayExpression') {
    return 'array'
  }
  if (init.type === 'NewExpression' && init.callee.type === 'Identifier') {
    const name = init.callee.name as string
    if (SET_TYPE_NAMES.has(name)) {
      return 'set'
    }
    if (MAP_TYPE_NAMES.has(name)) {
      return 'map'
    }
    if (ARRAY_TYPE_NAMES.has(name)) {
      return 'array'
    }
  }
  if (
    init.type === 'CallExpression' &&
    init.callee.type === 'MemberExpression' &&
    init.callee.object.type === 'Identifier' &&
    !init.callee.computed &&
    init.callee.property.type === 'Identifier'
  ) {
    const objName = init.callee.object.name as string
    const propName = init.callee.property.name as string
    if (objName === 'Array' && (propName === 'from' || propName === 'of')) {
      return 'array'
    }
    if (
      objName === 'Object' &&
      (propName === 'keys' || propName === 'values' || propName === 'entries')
    ) {
      return 'array'
    }
  }
  return 'unknown'
}

/**
 * Wire the per-file kind-tracking visitors into a rule's visitor
 * map. Returns the kinds Map and a record of visitor handlers the
 * caller should merge into its own visitor return. Use:
 *
 *   const { kinds, visitors } = trackKinds()
 *   return {
 *     ...visitors,
 *     ForStatement(node) { … kinds.get(name) … },
 *   }
 */
export function trackKinds(): {
  kinds: Map<string, Kind>
  visitors: Record<string, (node: AstNode) => void>
} {
  const kinds = new Map<string, Kind>()

  function record(name: string | undefined, kind: Kind): void {
    if (!name || kind === 'unknown') {
      return
    }
    kinds.set(name, kind)
  }

  function recordParams(params: AstNode[] | undefined): void {
    if (!params) {
      return
    }
    for (let i = 0, { length } = params; i < length; i += 1) {
      const p = params[i]
      if (!p || p.type !== 'Identifier') {
        continue
      }
      const name = p.name as string
      record(name, classifyTypeAnnotation(p.typeAnnotation))
    }
  }

  return {
    kinds,
    visitors: {
      VariableDeclarator(node: AstNode) {
        if (!node.id || node.id.type !== 'Identifier') {
          return
        }
        const name = node.id.name as string
        const annotated = classifyTypeAnnotation(node.id.typeAnnotation)
        if (annotated !== 'unknown') {
          record(name, annotated)
          return
        }
        record(name, classifyInit(node.init))
      },
      FunctionDeclaration(node: AstNode) {
        recordParams(node.params)
      },
      FunctionExpression(node: AstNode) {
        recordParams(node.params)
      },
      ArrowFunctionExpression(node: AstNode) {
        recordParams(node.params)
      },
    },
  }
}
