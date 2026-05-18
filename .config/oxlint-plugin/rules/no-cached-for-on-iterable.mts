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
 * Canonical fix: `for (const item of X) { … }`. This is THE fix
 * for sets / maps / iterables in this codebase — short, no extra
 * allocation, and reads as "iterate the set." Do NOT materialize
 * with `Array.from(X)` just to keep the cached-length shape going:
 * that's a workaround, not a fix, and it allocates a throwaway
 * array on every call.
 *
 * No autofix: while `for...of` is almost always correct, the
 * rule can't safely rewrite when the loop body mutates the
 * collection mid-iteration or relies on a frozen snapshot.
 * Report-only; the canonical replacement is one line and the
 * diagnostic message names it explicitly.
 */

import { FLAGGED_KINDS, trackKinds } from '../lib/iterable-kind.mts'
import type { AstNode, RuleContext } from '../lib/rule-types.mts'

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
        '`{{name}}` is a {{kind}} — cached-length `for` is a silent no-op (no `.length`, not integer-indexable). Use `for (const item of {{name}}) { … }` instead. (Do NOT materialize with `Array.from({{name}})` just to keep the cached-length shape — that adds a wasted allocation. `for...of` is the canonical fix for sets / maps / iterables.)',
    },
    schema: [],
  },

  create(context: RuleContext) {
    // Per-file kind map + the visitors that populate it. Shared with
    // prefer-cached-for-loop via lib/iterable-kind.mts so both rules
    // agree on what "this binding is a Set/Map/Iterable" means.
    const { kinds, visitors } = trackKinds()

    return {
      ...visitors,
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

export default rule
