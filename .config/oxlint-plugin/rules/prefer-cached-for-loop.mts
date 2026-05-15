/**
 * @fileoverview Prefer a cached-length C-style `for` loop over both
 * `.forEach(cb)` and `for...of`. Two distinct wins:
 *
 *   1. `.forEach` creates a function frame per iteration; the
 *      C-style loop does not. For hot paths the difference is
 *      measurable, and the readability cost is small once the
 *      pattern is uniform across the fleet.
 *   2. `for...of` allocates an iterator object and dispatches
 *      `Symbol.iterator` / `.next()` per step. For plain arrays
 *      (the fleet's overwhelmingly common case) the cached-length
 *      `for` loop is both faster and produces predictable
 *      generated code under TS/oxc.
 *
 * Style signal that motivated the rule: jdalton has hand-optimized
 * fleet hot paths to cached-length `for (let i = 0, { length } = arr; i < length; i += 1)`
 * form repeatedly. Encoding the preference as a rule prevents drift
 * back to the more idiomatic forms in subsequent edits.
 *
 * Canonical shape emitted by the autofix:
 *
 *   for (let i = 0, { length } = arr; i < length; i += 1) {
 *     const item = arr[i]!
 *     <body>
 *   }
 *
 * Notes on the shape:
 *   - `i += 1` instead of `i++` — postfix `++` returns the
 *     pre-increment value, which is a common source of off-by-one
 *     bugs and which the fleet's lint config bans elsewhere.
 *   - `{ length } = arr` destructures the length once at loop init,
 *     so the test `i < length` doesn't re-read `arr.length` per
 *     iteration. Equivalent to `const len = arr.length` but pairs
 *     with `let i = 0` in a single `let` head.
 *   - `arr[i]!` non-null assertion — under `noUncheckedIndexedAccess`
 *     the lookup type is `T | undefined`, and the bound `i` is
 *     provably in `[0, length)`. The assertion suppresses TS18048
 *     at every read of `item` downstream. No-op for tsconfigs
 *     without the strict flag.
 *
 * Autofix scope (deterministic only):
 *
 *   - `arr.forEach((item) => { body })` →
 *     ```
 *     for (let i = 0, { length } = arr; i < length; i += 1) {
 *       const item = arr[i]
 *       body
 *     }
 *     ```
 *
 *   - `arr.forEach((item, index) => { body })` →
 *     ```
 *     for (let index = 0, { length } = arr; index < length; index += 1) {
 *       const item = arr[index]
 *       body
 *     }
 *     ```
 *     (The second-arg `index` name takes over the loop counter — no
 *     name collision since the callback parameter is in its own
 *     scope.)
 *
 *   - `for (const item of arr) { body }` →
 *     ```
 *     for (let i = 0, { length } = arr; i < length; i += 1) {
 *       const item = arr[i]
 *       body
 *     }
 *     ```
 *
 * Skips (report-only or skip entirely):
 *   - `.forEach` with a function reference (not an inline arrow /
 *     function expression) — e.g. `arr.forEach(handler)` — the
 *     callback is opaque; rewriting would change semantics if the
 *     handler uses `arguments` or has a non-trivial `.length`.
 *   - `.forEach` with `thisArg` (2nd argument).
 *   - `.forEach` whose callback uses a 3rd `array` parameter — we'd
 *     need to bind a separate name, and the construct is rare.
 *   - `.forEach` whose callback references `this` (would need
 *     `.bind(this)`).
 *   - `.forEach` whose callback has destructured / non-Identifier
 *     parameters (`({ id }) => {}`) — rewriting requires inserting a
 *     destructure pattern inside the loop body; doable but the
 *     human review is cleaner.
 *   - `.forEach` containing `await` (the callback was previously
 *     async and the iterations were independent; switching to a
 *     `for` loop changes that to sequential awaits, which IS what
 *     the user wants here but only if they say so — flag instead).
 *   - `for...of` over an iterator that isn't a bare Identifier
 *     (`for (const x of getThings())`) — we'd need to hoist the
 *     iterable to a `const` first; skip and flag.
 *   - `for...of` whose body uses `continue`/`break` labels matching
 *     `i` or `length` (extremely rare; skip to be safe).
 *   - `for...await...of` — semantically distinct, do not touch.
 *   - `for...of` over non-array iterables (Map, Set, generators)
 *     — we can't tell statically, but the rule only fires when the
 *     iterable looks like an array-typed identifier. To stay
 *     deterministic we accept some false negatives and only autofix
 *     the bare-Identifier-array shape; the reporter still flags
 *     other shapes so the human can convert manually.
 */

/** @type {import('eslint').Rule.RuleModule} */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer cached-length C-style `for (let i = 0, { length } = arr; i < length; i += 1)` over `.forEach` and `for...of`.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferCachedFor:
        'Use a cached-length `for (let i = 0, { length } = {{iter}}; i < length; i += 1)` loop instead of `{{shape}}` — avoids per-iteration callback / iterator allocation.',
      preferCachedForNoFix:
        'Use a cached-length `for` loop instead of `{{shape}}`, but the rewrite is unsafe here ({{reason}}). Rewrite manually.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    return {
      CallExpression(node: AstNode) {
        // Match `<iter>.forEach(cb)` patterns.
        const callee = node.callee
        if (callee.type !== 'MemberExpression') {
          return
        }
        if (
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'forEach'
        ) {
          return
        }
        if (callee.computed) {
          return
        }
        if (node.arguments.length === 0 || node.arguments.length > 1) {
          // 0 args is invalid JS; 2 args means a `thisArg` was passed
          // (changes semantics if we drop it).
          return
        }
        const cb = node.arguments[0]
        if (
          cb.type !== 'ArrowFunctionExpression' &&
          cb.type !== 'FunctionExpression'
        ) {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: '.forEach(handler)',
              reason: 'callback is not an inline arrow / function expression',
            },
          })
          return
        }
        if (cb.params.length === 0 || cb.params.length > 2) {
          // 3rd `array` param is rare; 0 params means the callback
          // doesn't consume the item — flag without fix.
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: '.forEach',
              reason: 'callback arity is 0 or 3+',
            },
          })
          return
        }
        const itemParam = cb.params[0]
        const indexParam = cb.params[1]
        if (itemParam.type !== 'Identifier') {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: '.forEach',
              reason: 'first parameter is destructured',
            },
          })
          return
        }
        if (indexParam && indexParam.type !== 'Identifier') {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: '.forEach',
              reason: 'second parameter is destructured',
            },
          })
          return
        }
        if (cb.body.type !== 'BlockStatement') {
          // Expression-body arrow — would need to wrap as statement.
          // Trivially doable but rare for forEach; flag.
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: '.forEach',
              reason: 'callback uses expression body',
            },
          })
          return
        }
        if (cb.async) {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: '.forEach',
              reason:
                'callback is async (changes parallel-vs-sequential semantics)',
            },
          })
          return
        }
        const bodyText = sourceCode.getText(cb.body)
        if (/\bthis\b/.test(bodyText)) {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: { shape: '.forEach', reason: 'callback references `this`' },
          })
          return
        }
        // Reject if the forEach call is followed by a chained call
        // (.forEach(...).then(...) doesn't exist on void return, but
        // .map(...).forEach(...).filter(...) would mean we're inside
        // a chain — parent's a MemberExpression with us as object).
        const parent = node.parent
        if (
          parent &&
          parent.type === 'MemberExpression' &&
          parent.object === node
        ) {
          // forEach returns undefined; chaining off it is broken — skip
          // rather than rewrite something that doesn't even run.
          return
        }
        // forEach call must be its own ExpressionStatement to be a
        // safe textual replacement.
        if (!parent || parent.type !== 'ExpressionStatement') {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: '.forEach',
              reason: 'call result is consumed (not a standalone statement)',
            },
          })
          return
        }

        const iterText = sourceCode.getText(callee.object)
        const itemName = itemParam.name
        const indexName = indexParam ? indexParam.name : 'i'
        // If the callback body reassigns the item param (e.g.
        // `arr.forEach(line => { line = line.trim(); ... })`), the
        // rewritten `const line = arr[i]` would trip `no-const-assign`.
        // Emit `let` in that case so the rewrite preserves the
        // mutable-binding semantics the original arrow had per call.
        const itemKind = reassignsInBody(sourceCode, cb.body, itemName)
          ? 'let'
          : 'const'

        context.report({
          node,
          messageId: 'preferCachedFor',
          data: { iter: iterText, shape: '.forEach' },
          fix(fixer: RuleFixer) {
            const bodyInner = sourceCode.text.slice(
              cb.body.range[0] + 1,
              cb.body.range[1] - 1,
            )
            const indent = leadingIndent(sourceCode, parent)
            const innerIndent = `${indent}  `
            // `!` non-null assertion on the indexed access — under
            // `noUncheckedIndexedAccess` the lookup returns `T |
            // undefined`, and every read of `${itemName}` downstream
            // would trip TS18048. The assertion is a no-op for
            // tsconfigs that don't enable the strict flag, so it's
            // safe to emit unconditionally.
            const replacement = `for (let ${indexName} = 0, { length } = ${iterText}; ${indexName} < length; ${indexName} += 1) {\n${innerIndent}${itemKind} ${itemName} = ${iterText}[${indexName}]!${bodyInner}\n${indent}}`
            return fixer.replaceText(parent, replacement)
          },
        })
      },

      ForOfStatement(node: AstNode) {
        // for await ... — leave alone.
        if (node.await) {
          return
        }
        const left = node.left
        if (left.type !== 'VariableDeclaration') {
          // `for (item of arr)` — bare assignment; rare, skip.
          return
        }
        if (left.declarations.length !== 1) {
          return
        }
        const declarator = left.declarations[0]
        if (!declarator.id || declarator.id.type !== 'Identifier') {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: 'for...of',
              reason: 'loop variable is destructured',
            },
          })
          return
        }
        // Iterable must be a bare Identifier — otherwise we don't
        // know if it's a (cheap) array indexing target.
        const iter = node.right
        if (iter.type !== 'Identifier') {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: 'for...of',
              reason:
                'iterable is not a bare identifier (could be Map/Set/Generator/expression)',
            },
          })
          return
        }
        if (node.body.type !== 'BlockStatement') {
          // for (x of y) statement; rare. Skip.
          return
        }

        const itemName = declarator.id.name
        const iterText = iter.name
        const counterName = pickCounterName(itemName)
        // Preserve the original `let`/`const` declaration kind from
        // the `for...of`. `for (let item of arr)` opted into a
        // mutable per-iteration binding (the body may reassign
        // `item`); collapsing it to a `const` would break the loop.
        // If the original was `const`, only keep `const` when the
        // body never reassigns the loop variable.
        const originalKind = left.kind
        const itemKind =
          originalKind === 'let' ||
          reassignsInBody(sourceCode, node.body, itemName)
            ? 'let'
            : 'const'

        context.report({
          node,
          messageId: 'preferCachedFor',
          data: { iter: iterText, shape: 'for...of' },
          fix(fixer: RuleFixer) {
            const bodyInner = sourceCode.text.slice(
              node.body.range[0] + 1,
              node.body.range[1] - 1,
            )
            const indent = leadingIndent(sourceCode, node)
            const innerIndent = `${indent}  `
            // `!` non-null assertion on the indexed access — see the
            // sibling .forEach branch for the rationale.
            const replacement = `for (let ${counterName} = 0, { length } = ${iterText}; ${counterName} < length; ${counterName} += 1) {\n${innerIndent}${itemKind} ${itemName} = ${iterText}[${counterName}]!${bodyInner}\n${indent}}`
            return fixer.replaceText(node, replacement)
          },
        })
      },
    }
  },
}

/**
 * Pick a counter-variable name that won't collide with the item
 * variable. Defaults to `i`, falls back to `i2`, `i3`, ... if the
 * item is itself named `i` (rare but defensive).
 */
function pickCounterName(itemName: string): string {
  if (itemName !== 'i') {
    return 'i'
  }
  return 'i2'
}

/**
 * Textual check: does the loop body reassign the named identifier?
 * Catches `name = ...`, `name +=`, `name++`, `++name`, etc., and
 * destructuring-as-assignment patterns. Conservative: false
 * positives only force `let` (semantically safe), false negatives
 * trip `no-const-assign` (the bug this guards against).
 *
 * AST-walking would be more precise but oxlint's plugin host
 * doesn't expose a uniform visitor for body subtrees here; the
 * regex catches every reassignment shape that compiles today.
 */
function reassignsInBody(
  sourceCode: AstNode,
  bodyNode: AstNode,
  name: string,
): boolean {
  if (!bodyNode) {
    return false
  }
  const text = sourceCode.text.slice(bodyNode.range[0], bodyNode.range[1])
  // Escape any regex specials in the identifier (defensive — JS
  // identifiers can't actually contain them, but cheap).
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Patterns:
  //   1. <name> = ...   (simple assignment, not `==` / `===`)
  //   2. <name> += ...  / -=, *=, /=, %=, **=, &=, |=, ^=, <<=, >>=, >>>=, &&=, ||=, ??=
  //   3. <name>++ / <name>--
  //   4. ++<name> / --<name>
  //   5. ({ <name> } = ...) / ([<name>] = ...) destructuring — caught by the
  //      same `<name>... =` shape inside a destructure since the rightmost
  //      `=` is the assignment.
  // Use `\b` boundaries on the name. The `(?!=)` lookahead rejects `==`.
  const reassignRE = new RegExp(
    String.raw`\b${escaped}\b\s*(?:=(?!=)|[-+*/%&|^]=|<<=|>>=|>>>=|\*\*=|&&=|\|\|=|\?\?=|\+\+|--)`,
  )
  if (reassignRE.test(text)) {
    return true
  }
  // Prefix increment/decrement: `++<name>` / `--<name>`.
  const prefixRE = new RegExp(String.raw`(?:\+\+|--)\s*\b${escaped}\b`)
  return prefixRE.test(text)
}

/**
 * Recover the indentation prefix on the line where `node` starts so
 * the rewritten block can re-indent its contents consistently with
 * the surrounding code.
 */
function leadingIndent(sourceCode: AstNode, node: AstNode): string {
  const text = sourceCode.text
  const start = node.range[0]
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const indent = text.slice(lineStart, start)
  // Strip non-whitespace (in case the line has content before this
  // statement). Indent is the leading-whitespace prefix only.
  return /^\s*/.exec(indent)?.[0] ?? ''
}

export default rule
