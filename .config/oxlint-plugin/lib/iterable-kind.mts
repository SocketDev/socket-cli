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
 * # Scope handling
 *
 * Bindings are resolved by walking the AST `parent` chain from the
 * USE site upward, stopping at the nearest scope-creating node that
 * declares the name. A scope-creating node is any of:
 *
 *   - `Program` (module / file scope)
 *   - `BlockStatement` (function body, if/for/while body, bare block)
 *   - `ForStatement` / `ForOfStatement` / `ForInStatement` (the head
 *     binding `let i = 0` is scoped to the loop, not the surrounding
 *     block)
 *   - any `Function*` node (parameters are scoped to that function)
 *   - `CatchClause` (the caught-error binding)
 *
 * This is the JS `let`/`const` block-scoping model. The fleet's code
 * uses `const` / `let` exclusively (no `var`), so we don't need to
 * model `var`'s function-scope hoisting separately.
 *
 * Earlier revisions of this module used a single flat `Map<name,
 * Kind>` populated by visitor side-effect. That model conflated
 * bindings across scopes — a function-local `const closure = new
 * Map()` propagated the `map` classification to every other
 * binding in the file named `closure`, including unrelated arrays
 * in the parent scope. The scope-walk path fixes that at the cost
 * of a per-lookup walk; rule lookups happen on `ForStatement` and
 * `MemberExpression` which are relatively rare, so the overhead is
 * bounded.
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

const SCOPE_NODE_TYPES = new Set([
  'Program',
  'BlockStatement',
  'ForStatement',
  'ForOfStatement',
  'ForInStatement',
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'TSDeclareFunction',
  'CatchClause',
  // Class body has its own lexical environment for method `this` etc.,
  // but doesn't host `let`/`const` declarations at the body level (only
  // method definitions). Including it doesn't hurt.
  'ClassDeclaration',
  'ClassExpression',
])

const FUNCTION_NODE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'TSDeclareFunction',
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
 * Classify a single VariableDeclarator AST node. Type annotation
 * wins over inferred init kind (explicit > implicit).
 */
function classifyVariableDeclarator(declarator: AstNode): Kind {
  if (!declarator || !declarator.id || declarator.id.type !== 'Identifier') {
    return 'unknown'
  }
  const annotated = classifyTypeAnnotation(declarator.id.typeAnnotation)
  if (annotated !== 'unknown') {
    return annotated
  }
  return classifyInit(declarator.init)
}

/**
 * Find a binding for `name` declared *directly* in the given scope
 * node (does not recurse into nested scopes). Returns the classified
 * Kind, or undefined if no such binding exists in this scope.
 *
 * Each scope-node type stores its declarations differently:
 *
 *   - `Program` / `BlockStatement`: scan `body` for top-level
 *     `VariableDeclaration` and `FunctionDeclaration` nodes.
 *   - `Function*`: check the function's `params` for an Identifier
 *     param named `name`. The body BlockStatement is a separate
 *     scope (visited on the way up).
 *   - `ForStatement`: check the `init` (a VariableDeclaration whose
 *     declarators are scoped to the loop).
 *   - `ForOfStatement` / `ForInStatement`: check the `left` (a
 *     VariableDeclaration declaring the loop var, scoped to the loop).
 *   - `CatchClause`: check the `param` Identifier.
 */
function findInScope(scope: AstNode, name: string): Kind | undefined {
  if (!scope) {
    return undefined
  }

  // Function parameter scope.
  if (FUNCTION_NODE_TYPES.has(scope.type)) {
    const params: AstNode[] | undefined = scope.params
    if (params) {
      for (let i = 0, { length } = params; i < length; i += 1) {
        const p = params[i]
        if (p && p.type === 'Identifier' && (p.name as string) === name) {
          return classifyTypeAnnotation(p.typeAnnotation)
        }
      }
    }
    return undefined
  }

  // Catch clause: single Identifier param.
  if (scope.type === 'CatchClause') {
    const p = scope.param
    if (p && p.type === 'Identifier' && (p.name as string) === name) {
      return classifyTypeAnnotation(p.typeAnnotation)
    }
    return undefined
  }

  // for (let X = …; …; …) — declaration is in scope.init.
  if (scope.type === 'ForStatement') {
    const init: AstNode | undefined = scope.init
    if (init && init.type === 'VariableDeclaration') {
      const k = findInVariableDeclaration(init, name)
      if (k !== undefined) {
        return k
      }
    }
    return undefined
  }

  // for (const X of …) / for (const X in …) — declaration is in scope.left.
  if (
    scope.type === 'ForOfStatement' ||
    scope.type === 'ForInStatement'
  ) {
    const left: AstNode | undefined = scope.left
    if (left && left.type === 'VariableDeclaration') {
      const k = findInVariableDeclaration(left, name)
      if (k !== undefined) {
        return k
      }
    }
    return undefined
  }

  // Program or BlockStatement: scan body for declarations.
  if (scope.type === 'Program' || scope.type === 'BlockStatement') {
    const body: AstNode[] | undefined = scope.body
    if (!body) {
      return undefined
    }
    for (let i = 0, { length } = body; i < length; i += 1) {
      const stmt = body[i]
      if (!stmt) {
        continue
      }
      if (stmt.type === 'VariableDeclaration') {
        const k = findInVariableDeclaration(stmt, name)
        if (k !== undefined) {
          return k
        }
      } else if (
        stmt.type === 'ExportNamedDeclaration' &&
        stmt.declaration &&
        stmt.declaration.type === 'VariableDeclaration'
      ) {
        const k = findInVariableDeclaration(stmt.declaration, name)
        if (k !== undefined) {
          return k
        }
      }
    }
    return undefined
  }

  return undefined
}

/**
 * Scan a VariableDeclaration node's declarators for one whose id is
 * `Identifier(name)`. Returns the classified Kind if found, else
 * undefined.
 */
function findInVariableDeclaration(
  decl: AstNode,
  name: string,
): Kind | undefined {
  const decls: AstNode[] | undefined = decl.declarations
  if (!decls) {
    return undefined
  }
  for (let i = 0, { length } = decls; i < length; i += 1) {
    const d = decls[i]
    if (
      d &&
      d.id &&
      d.id.type === 'Identifier' &&
      (d.id.name as string) === name
    ) {
      return classifyVariableDeclarator(d)
    }
  }
  return undefined
}

/**
 * Resolve `name` as seen from the use-site `useNode`. Walks the
 * AST parent chain, checking each scope-creating ancestor for a
 * direct declaration of `name`. Returns the nearest enclosing
 * scope's classification, or `'unknown'` if no declaration is
 * found.
 *
 * The walk stops on the first declaring scope (JS lookup
 * semantics): a function-local `const closure = new Map()` shadows
 * an outer `const closure = await fn()` even if the inner is
 * declared "later" in source order, because they live in
 * different scopes and the use-site picks the nearest declaring
 * scope on its parent chain.
 */
export function resolveKind(useNode: AstNode, name: string): Kind {
  let cur: AstNode | undefined = useNode
  while (cur) {
    if (SCOPE_NODE_TYPES.has(cur.type)) {
      const k = findInScope(cur, name)
      if (k !== undefined) {
        return k
      }
    }
    cur = cur.parent
  }
  return 'unknown'
}

/**
 * Wire the scope-aware kind resolver into a rule. Returns
 * `resolveKind(useNode, name)` for the rule to call from its
 * use-site visitors (e.g. ForStatement / MemberExpression).
 *
 * Unlike the older `trackKinds()` API, this returns no visitors:
 * the resolver walks the AST on-demand instead of building a
 * pre-populated map. The trade-off is one parent-chain walk per
 * lookup vs. an O(file-size) population pass at create() time.
 * Lookups are scoped to rule call sites (ForStatement,
 * MemberExpression with a Set/Map LHS), so the per-lookup cost
 * is bounded.
 *
 * Usage:
 *
 *   const resolveKind = createKindResolver()
 *   return {
 *     ForStatement(node) {
 *       const kind = resolveKind(node, 'someName')
 *       …
 *     },
 *   }
 */
export function createKindResolver(): (
  useNode: AstNode,
  name: string,
) => Kind {
  return resolveKind
}
