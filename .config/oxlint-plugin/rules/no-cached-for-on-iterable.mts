/**
 * @fileoverview Catch the silent-no-op bug where the fleet's canonical
 * cached-length `for` loop is applied to a Set / Map / Iterable
 * instead of an array.
 *
 * The bug shape:
 *
 *   const s: Set<string> = new Set()
 *   …
 *   for (let i = 0, { length } = s; i < length; i += 1) {
 *     const item = s[i]!         // s isn't indexable; type is undefined
 *     …                          // body never runs (length is undefined)
 *   }
 *
 * `Set` / `Map` / `WeakSet` / `WeakMap` / generic `Iterable` don't
 * expose `.length`, and `s[i]` isn't a defined access either. The
 * destructure `{ length } = s` reads `s.length === undefined`, the
 * test `i < undefined` is `false`, and the loop body never executes.
 * No type error, no runtime error — the iteration just silently
 * does nothing. Production code shipped with this pattern across
 * 4 files in socket-wheelhouse before the fleet hand-fix; this rule
 * blocks regression.
 *
 * Why it happens: the fleet's `socket/prefer-cached-for-loop` rule
 * rewrites array `.forEach` and array `for...of` into the cached-
 * length shape. Devs then apply the same shape by hand to Set / Map
 * iteration without remembering that those collections aren't
 * integer-indexable.
 *
 * Detection (no TypeScript type-checker available in the plugin):
 *
 *   1. Walk every `VariableDeclarator` and `Parameter` in scope to
 *      build a per-file map `identifierName -> kind` where `kind`
 *      ∈ {set, map, iterable, array, unknown}. Recognized signals:
 *
 *        - `new Set(...)` / `new Map(...)` / `new WeakSet(...)` /
 *          `new WeakMap(...)`           → set/map kind
 *        - `: Set<...>` / `: ReadonlySet<...>` / `: Map<...>` /
 *          `: ReadonlyMap<...>` /
 *          `: WeakSet<...>` / `: WeakMap<...>` annotations
 *          → set/map kind
 *        - `: Iterable<...>` / `: AsyncIterable<...>` annotations
 *          → iterable kind
 *        - `[…]` array literal / `: T[]` / `: Array<...>` /
 *          `: ReadonlyArray<...>`       → array kind (negative —
 *          do NOT flag)
 *        - everything else               → unknown kind (skip)
 *
 *   2. On `ForStatement`, inspect the `init` for the canonical
 *      shape:
 *
 *        let i = 0, { length } = X
 *
 *      i.e. `VariableDeclaration` with ≥ 2 declarators, the second
 *      of which has an `ObjectPattern` LHS with a single `length`
 *      property and an `Identifier` RHS `X`. Look up `X` in the
 *      scope map — if it resolves to `set` / `map` / `iterable`,
 *      report.
 *
 * False-negative bias on purpose: when the kind is `unknown` we
 * skip silently. Better to miss a bug than to nag every cached-for
 * loop in the codebase. The 4 fleet incidents that motivated the
 * rule all had a clear `new Set(...)` / `: Set<T>` annotation in
 * scope; the high-signal cases are the ones we catch.
 *
 * No autofix: the right rewrite depends on intent. If the loop
 * needs index access, the human must materialize via
 * `Array.from(X)`. If it only needs item access, `for (const item
 * of X)` is correct. Auto-choosing the wrong one would silently
 * change semantics (e.g. `Array.from(map)` returns entry pairs,
 * not values). Report-only; pair with a clear remediation hint.
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

// Type-annotation strings that mark a binding as a known collection
// kind. Matched against the source-code slice of the annotation —
// keeps the rule simple at the cost of false positives on shadowed
// generic names (acceptable: the fleet doesn't shadow these).
const SET_TYPE_NAMES = new Set([
  'Set',
  'ReadonlySet',
  'WeakSet',
])

const MAP_TYPE_NAMES = new Set([
  'Map',
  'ReadonlyMap',
  'WeakMap',
])

const ITERABLE_TYPE_NAMES = new Set([
  'Iterable',
  'AsyncIterable',
  'IterableIterator',
])

const ARRAY_TYPE_NAMES = new Set([
  'Array',
  'ReadonlyArray',
])

type Kind = 'set' | 'map' | 'iterable' | 'array' | 'unknown'

// The non-array kinds — these are the ones we flag.
const FLAGGED_KINDS: ReadonlySet<Kind> = new Set(['set', 'map', 'iterable'])

/**
 * Classify a TS type-annotation AST node into a Kind. Recognizes the
 * shallow forms (`Set<…>`, `Map<…>`, etc.); generic wrappers like
 * `Promise<Set<…>>` are not unwrapped — they resolve to `unknown`,
 * which is the safe (skip-silently) outcome.
 */
function classifyTypeAnnotation(annotation: AstNode | undefined): Kind {
  if (!annotation || !annotation.typeAnnotation) {
    return 'unknown'
  }
  const t = annotation.typeAnnotation
  // `: T[]` → array.
  if (t.type === 'TSArrayType') {
    return 'array'
  }
  // `: Set<T>` / `: Map<K, V>` / `: Iterable<T>` / `: Array<T>` etc.
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
 * Classify the initializer expression a `VariableDeclarator` is
 * bound to.
 */
function classifyInit(init: AstNode | undefined): Kind {
  if (!init) {
    return 'unknown'
  }
  // `[…]` array literal → array (we'll skip these).
  if (init.type === 'ArrayExpression') {
    return 'array'
  }
  // `new Set(...)`, `new Map(...)`, etc.
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
  // `Array.from(...)` / `Array.of(...)` / `Object.keys/values/entries(...)`
  // → array. These are common materialization sites and worth
  // catching as negative signals so the rule doesn't fire on
  // post-fix code.
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
 * The cached-for-loop init shape we're looking for:
 *
 *   let i = 0, { length } = X
 *
 * Returns the identifier `X` if the shape matches and `X` is a
 * bare Identifier, otherwise undefined.
 */
function matchCachedForInit(init: AstNode | undefined): string | undefined {
  if (!init || init.type !== 'VariableDeclaration') {
    return undefined
  }
  const decls = init.declarations
  if (!decls || decls.length < 2) {
    return undefined
  }
  // The `{ length } = X` declarator. Could be at any position after
  // the counter, but the canonical fleet shape puts it second.
  for (let i = 0, { length: declsLen } = decls; i < declsLen; i += 1) {
    const d = decls[i]
    if (
      d.id &&
      d.id.type === 'ObjectPattern' &&
      d.id.properties &&
      d.id.properties.length === 1 &&
      d.id.properties[0].type === 'Property' &&
      d.id.properties[0].key &&
      d.id.properties[0].key.type === 'Identifier' &&
      d.id.properties[0].key.name === 'length' &&
      d.init &&
      d.init.type === 'Identifier'
    ) {
      return d.init.name as string
    }
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Don't apply the cached-length `for (let i = 0, { length } = X; …)` pattern to Sets, Maps, or generic Iterables — it silently no-ops (X has no `.length` and isn't integer-indexable).",
      category: 'Correctness',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      noCachedForOnIterable:
        '`{{name}}` is a {{kind}} — cached-length `for` is a silent no-op (no `.length`, not integer-indexable). Use `Array.from({{name}})` for indexed iteration, or `for (const item of {{name}})` for sequential access.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    // Per-file map: identifier name → known kind.
    const kinds = new Map<string, Kind>()

    // Helper: record a kind for an identifier name; only overwrite if
    // the new info is more specific (unknown loses to everything else).
    function record(name: string | undefined, kind: Kind): void {
      if (!name || kind === 'unknown') {
        return
      }
      kinds.set(name, kind)
    }

    return {
      // Catch:
      //   const s = new Set()
      //   const s: Set<string> = …
      //   const s: Set<string> = new Set()
      //   const arr: string[] = []
      //   const arr = [1, 2, 3]
      VariableDeclarator(node: AstNode) {
        if (!node.id || node.id.type !== 'Identifier') {
          return
        }
        const name = node.id.name as string
        // Type annotation takes priority — explicit > inferred.
        const annotated = classifyTypeAnnotation(node.id.typeAnnotation)
        if (annotated !== 'unknown') {
          record(name, annotated)
          return
        }
        record(name, classifyInit(node.init))
      },

      // Catch annotated parameters:
      //   function f(items: Set<string>) { … }
      //   const f = (items: Map<string, number>) => { … }
      FunctionDeclaration(node: AstNode) {
        recordParams(node.params, record)
      },
      FunctionExpression(node: AstNode) {
        recordParams(node.params, record)
      },
      ArrowFunctionExpression(node: AstNode) {
        recordParams(node.params, record)
      },

      ForStatement(node: AstNode) {
        const iterName = matchCachedForInit(node.init)
        if (!iterName) {
          return
        }
        const kind = kinds.get(iterName) ?? 'unknown'
        if (!FLAGGED_KINDS.has(kind)) {
          return
        }
        context.report({
          node: node.init,
          messageId: 'noCachedForOnIterable',
          data: { name: iterName, kind },
        })
      },
    }
  },
}

function recordParams(
  params: AstNode[] | undefined,
  record: (name: string | undefined, kind: Kind) => void,
): void {
  if (!params) {
    return
  }
  for (let i = 0, { length } = params; i < length; i += 1) {
    const p = params[i]
    if (!p || p.type !== 'Identifier') {
      continue
    }
    const name = p.name as string
    const annotated = classifyTypeAnnotation(p.typeAnnotation)
    record(name, annotated)
  }
}

export default rule
