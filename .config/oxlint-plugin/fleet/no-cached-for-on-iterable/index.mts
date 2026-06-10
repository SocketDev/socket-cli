/**
 * @file Catch the silent-no-op bug where the fleet's canonical cached-length
 *   `for` loop is applied to a Set / Map / Iterable instead of an array. The
 *   bug shape: const s: Set<string> = new Set() … for (let i = 0, { length } =
 *   s; i < length; i += 1) { const item = s[i]! // s isn't indexable; type is
 *   undefined … // body never runs (length is undefined) } `Set` / `Map` /
 *   `WeakSet` / `WeakMap` / generic `Iterable` don't expose `.length`, and
 *   `s[i]` isn't a defined access either. The destructure `{ length } = s`
 *   reads `s.length === undefined`, the test `i < undefined` is `false`, and
 *   the loop body never executes. No type error, no runtime error — the
 *   iteration just silently does nothing. Production code shipped with this
 *   pattern across 4 files in socket-wheelhouse before the fleet hand-fix; this
 *   rule blocks regression. Why it happens: the fleet's
 *   `socket/prefer-cached-for-loop` rule rewrites array `.forEach` and array
 *   `for...of` into the cached- length shape. Devs then apply the same shape by
 *   hand to Set / Map iteration without remembering that those collections
 *   aren't integer-indexable. Detection (no TypeScript type-checker available
 *   in the plugin):
 *
 *   1. Walk every `VariableDeclarator` and `Parameter` in scope to build a
 *      per-file map `identifierName -> kind` where `kind` ∈ {set, map,
 *      iterable, array, unknown}. Recognized signals:
 *
 *   - `new Set(...)` / `new Map(...)` / `new WeakSet(...)` / `new WeakMap(...)` →
 *     set/map kind
 *   - `: Set<...>` / `: ReadonlySet<...>` / `: Map<...>` / `: ReadonlyMap<...>` /
 *     `: WeakSet<...>` / `: WeakMap<...>` annotations → set/map kind
 *   - `: Iterable<...>` / `: AsyncIterable<...>` annotations → iterable kind
 *   - `[…]` array literal / `: T[]` / `: Array<...>` / `: ReadonlyArray<...>` →
 *     array kind (negative — do NOT flag)
 *   - everything else → unknown kind (skip)
 *
 *   2. On `ForStatement`, inspect the `init` for the canonical shape: let i = 0, {
 *      length } = X i.e. `VariableDeclaration` with ≥ 2 declarators, the second
 *      of which has an `ObjectPattern` LHS with a single `length` property and
 *      an `Identifier` RHS `X`. Look up `X` in the scope map — if it resolves
 *      to `set` / `map` / `iterable`, report. False-negative bias on purpose:
 *      when the kind is `unknown` we skip silently. Better to miss a bug than
 *      to nag every cached-for loop in the codebase. The 4 fleet incidents that
 *      motivated the rule all had a clear `new Set(...)` / `: Set<T>`
 *      annotation in scope; the high-signal cases are the ones we catch.
 *      Canonical fix: `for (const item of X) { … }`. This is THE fix for sets /
 *      maps / iterables in this codebase — short, no extra allocation, and
 *      reads as "iterate the set." Do NOT materialize with `Array.from(X)` just
 *      to keep the cached-length shape going: that's a workaround, not a fix,
 *      and it allocates a throwaway array on every call. No autofix: while
 *      `for...of` is almost always correct, the rule can't safely rewrite when
 *      the loop body mutates the collection mid-iteration or relies on a frozen
 *      snapshot. Report-only; the canonical replacement is one line and the
 *      diagnostic message names it explicitly.
 */

import { FLAGGED_KINDS, createKindResolver } from '../../lib/iterable-kind.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

/**
 * The cached-for-loop init shape we're looking for:
 *
 * Let i = 0, { length } = X.
 *
 * Returns the identifier `X` if the shape matches and `X` is a bare Identifier,
 * otherwise undefined.
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
      lengthOnIterable:
        '`{{name}}.length` reads `undefined` — {{kind}} has `.size`, not `.length`. Either rename to `.size`, or convert `{{name}}` to an array first if the semantics demand `.length`.',
      indexedAccessOnIterable:
        "`{{name}}[…]` returns `undefined` — {{kind}} isn't integer-indexable. Use `for (const item of {{name}})` (or one of the entries / keys / values iterators) to read elements.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    // Scope-aware kind resolver. Shared with prefer-cached-for-loop
    // via lib/iterable-kind.mts so both rules agree on what "this
    // binding is a Set/Map/Iterable" means — including under
    // shadowing (a function-local `const closure = new Map()`
    // does NOT taint an outer-scope `const closure = await fn()`
    // array binding).
    const resolveKind = createKindResolver()

    // Track ForStatements that already fired `noCachedForOnIterable`
    // for a given iterable name. When a MemberExpression visitor
    // later sees `iterName[i]` or `iterName.length` *inside* one
    // of these loops, we suppress the secondary finding — the
    // single root cause (the loop shape) is already reported, and
    // emitting both findings creates one noise-per-iteration of
    // body access for the user to ignore. The body fix follows
    // from fixing the loop, so the secondary report is redundant.
    //
    // Keyed by the ForStatement AST node identity (Map<AstNode,
    // string>); lookup walks the use-site's parent chain to find
    // an enclosing flagged loop with the matching iterName.
    const flaggedLoops = new Map<AstNode, string>()

    // Check whether `useNode` is nested inside a ForStatement that
    // was reported with `iterName`. Walks the parent chain.
    function insideFlaggedLoopFor(useNode: AstNode, iterName: string): boolean {
      let cur: AstNode | undefined = useNode.parent
      while (cur) {
        if (cur.type === 'ForStatement') {
          const flaggedName = flaggedLoops.get(cur)
          if (flaggedName === iterName) {
            return true
          }
        }
        cur = cur.parent
      }
      return false
    }

    return {
      ForStatement(node: AstNode) {
        const iterName = matchCachedForInit(node.init)
        if (!iterName) {
          return
        }
        const kind = resolveKind(node, iterName)
        if (!FLAGGED_KINDS.has(kind)) {
          return
        }
        flaggedLoops.set(node, iterName)
        context.report({
          node: node.init,
          messageId: 'noCachedForOnIterable',
          data: { name: iterName, kind },
        })
      },
      MemberExpression(node: AstNode) {
        // Only flag when the object is a bare Identifier resolving
        // to a known Set/Map/Iterable. Anything else (member chain,
        // call result) is too noisy without type info.
        if (!node.object || node.object.type !== 'Identifier') {
          return
        }
        const name = node.object.name as string
        const kind = resolveKind(node, name)
        if (!FLAGGED_KINDS.has(kind)) {
          return
        }
        // Suppress when inside an enclosing flagged for-loop that
        // matched this same iterable name — the cached-for finding
        // already covers the root cause; the body access is just
        // a downstream symptom that gets fixed by fixing the loop.
        //
        // NOTE: this depends on visitor order. Oxlint walks the
        // tree top-down, so the enclosing ForStatement is visited
        // before its body's MemberExpressions. The flaggedLoops
        // map is populated in time for the body's lookups. If a
        // future oxlint version changes traversal order, this
        // suppression becomes a no-op (we'd dual-fire again, which
        // is the current noisy behavior — not a correctness
        // regression).
        if (insideFlaggedLoopFor(node, name)) {
          return
        }
        // `setVar.length` — direct property read; always undefined.
        // Skip when used as the LHS of an assignment (extremely
        // unlikely on a Set but cheap to be safe) or when used
        // inside a member chain we can't reason about.
        if (
          !node.computed &&
          node.property &&
          node.property.type === 'Identifier' &&
          node.property.name === 'length'
        ) {
          // Skip the destructure shape `{ length } = setVar` — that's
          // the for-loop init the ForStatement visitor already
          // reports on, so we'd double-fire here. The destructure's
          // member access doesn't go through MemberExpression in any
          // oxlint version we've seen, but cover it defensively.
          if (
            node.parent &&
            node.parent.type === 'AssignmentPattern' &&
            node.parent.left === node
          ) {
            return
          }
          context.report({
            node,
            messageId: 'lengthOnIterable',
            data: { name, kind },
          })
          return
        }
        // `setVar[<idx>]` — computed property access. Restrict to
        // shapes where the index looks numeric (number literal,
        // Identifier counter — `i` / `j` / `index`). A bare
        // `setVar[someKey]` could be a Map-key lookup misshaping a
        // get(), so be conservative: only flag when the surface
        // strongly suggests array-style indexed read.
        if (node.computed && node.property) {
          const p = node.property
          const looksNumeric =
            (p.type === 'Literal' && typeof p.value === 'number') ||
            (p.type === 'NumericLiteral' && typeof p.value === 'number') ||
            (p.type === 'Identifier' &&
              typeof p.name === 'string' &&
              /^(cur|cursor|i|idx|index|j|k|n|pos)$/.test(p.name))
          if (looksNumeric) {
            context.report({
              node,
              messageId: 'indexedAccessOnIterable',
              data: { name, kind },
            })
          }
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
