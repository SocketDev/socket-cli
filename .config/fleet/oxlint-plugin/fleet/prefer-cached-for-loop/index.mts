/*
 * @file Prefer a cached-length C-style `for` loop over both `.forEach(cb)` and
 *   `for...of`. Two distinct wins:
 *
 *   1. `.forEach` creates a function frame per iteration; the C-style loop does
 *      not. For hot paths the difference is measurable, and the readability
 *      cost is small once the pattern is uniform across the fleet.
 *   2. `for...of` allocates an iterator object and dispatches `Symbol.iterator` /
 *      `.next()` per step. For plain arrays (the fleet's overwhelmingly common
 *      case) the cached-length `for` loop is both faster and produces
 *      predictable generated code under TS/oxc. Style signal that motivated the
 *      rule: jdalton has hand-optimized fleet hot paths to cached-length `for
 *      (let i = 0, { length } = arr; i < length; i += 1)` form repeatedly.
 *      Encoding the preference as a rule prevents drift back to the more
 *      idiomatic forms in subsequent edits. Canonical shape emitted by the
 *      autofix on a TypeScript file (`.ts`/`.tsx`/`.mts`/`.cts`): for (let i =
 *      0, { length } = arr; i < length; i += 1) { const item = arr[i]!
 *
 *   <body>
 *   }
 *   On a plain JS file (`.js`/`.mjs`/`.cjs`/…) the same shape is emitted
 *   WITHOUT the trailing `!` (`const item = arr[i]`) — the non-null assertion
 *   is TypeScript-only syntax and would be a SyntaxError in plain JS. The
 *   rule detects the file kind via `context.filename`, the same
 *   `/\.(?:cts|mts|tsx?)$/` extension check `optional-explicit-undefined`
 *   uses.
 *   Notes on the shape:
 *   - `i += 1` instead of `i++` — postfix `++` returns the
 *   pre-increment value, which is a common source of off-by-one
 *   bugs and which the fleet's lint config bans elsewhere.
 *   - `{ length } = arr` destructures the length once at loop init,
 *   so the test `i < length` doesn't re-read `arr.length` per
 *   iteration. Equivalent to `const len = arr.length` but pairs
 *   with `let i = 0` in a single `let` head.
 *   - `arr[i]!` non-null assertion, TypeScript files only — under
 *   `noUncheckedIndexedAccess` the lookup type is `T | undefined`,
 *   and the bound `i` is provably in `[0, length)`. The assertion
 *   suppresses TS18048 at every read of `item` downstream. No-op
 *   for tsconfigs without the strict flag.
 *   Autofix scope (deterministic only):
 *   - `arr.forEach((item) => { body })` →
 *   ```
 *   for (let i = 0, { length } = arr; i < length; i += 1) {
 *   const item = arr[i]
 *   body
 *   }
 *   ```
 *   - `arr.forEach((item, index) => { body })` →
 *   ```
 *   for (let index = 0, { length } = arr; index < length; index += 1) {
 *   const item = arr[index]
 *   body
 *   }
 *   ```
 *   (The second-arg `index` name takes over the loop counter — no
 *   name collision since the callback parameter is in its own
 *   scope.)
 *   - `for (const item of arr) { body }` →
 *   ```
 *   for (let i = 0, { length } = arr; i < length; i += 1) {
 *   const item = arr[i]
 *   body
 *   }
 *   ```
 *   Skips (report-only or skip entirely):
 *   - `.forEach` with a function reference (not an inline arrow /
 *   function expression) — e.g. `arr.forEach(handler)` — the
 *   callback is opaque; rewriting would change semantics if the
 *   handler uses `arguments` or has a non-trivial `.length`.
 *   - `.forEach` with `thisArg` (2nd argument).
 *   - `.forEach` whose callback uses a 3rd `array` parameter — we'd
 *   need to bind a separate name, and the construct is rare.
 *   - `.forEach` whose callback references `this` (would need
 *   `.bind(this)`).
 *   - `.forEach` whose callback has destructured / non-Identifier
 *   parameters (`({ id }) => {}`) — rewriting requires inserting a
 *   destructure pattern inside the loop body; doable but the
 *   human review is cleaner.
 *   - `.forEach` containing `await` (the callback was previously
 *   async and the iterations were independent; switching to a
 *   `for` loop changes that to sequential awaits, which IS what
 *   the user wants here but only if they say so — flag instead).
 *   - `for...of` over an iterator that isn't a bare Identifier
 *   (`for (const x of getThings())`, `for (const x of obj.list)`)
 *   — we'd need to hoist the iterable to a `const` first; skip
 *   SILENTLY. The rewrite is doable in many cases but the human
 *   review is cleaner, and the rule's user experience is bad if
 *   it reports an unfixable warning for every member-access loop.
 *   - `for...of` whose loop variable is destructured
 *   (`for (const [k, v] of m)`, `for (const { x } of arr)`)
 *   — the typical source is a Map / Set / `.entries()` iteration
 *   where there's no equivalent cached-for-loop shape (Maps aren't
 *   integer-indexable). Skip SILENTLY.
 *   - `for...of` whose body uses `continue`/`break` labels matching
 *   `i` or `length` (extremely rare; skip to be safe).
 *   - `for...await...of` — semantically distinct, do not touch.
 *   The earlier revision of this rule reported `preferCachedForNoFix`
 *   for the two skip-silently cases above. That surfaced as a lint
 *   error per location with no autofix path — the user had no way to
 *   resolve the finding short of hand-rewriting (often impossible:
 *   Maps don't have an indexed form). Now the rule only emits findings
 *   when an autofix is available; the cases above are skipped without
 *   a report at all.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import {
  classifyInit,
  createKindResolver,
  FLAGGED_KINDS,
} from '../../lib/iterable-kind.mts'
import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'problem',
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

    // The `!` non-null assertion on the rewritten indexed access is
    // TypeScript-only syntax — emitting it into a `.js`/`.mjs`/`.cjs` file
    // produces a SyntaxError. Same extension check `optional-explicit-undefined`
    // uses. An unresolvable filename (e.g. a bare mock context in a unit
    // test) is treated as non-TypeScript — the safe default, since emitting
    // valid-everywhere JS is never wrong, while emitting `!` into an unknown
    // file kind can be.
    const filename = context.filename ?? context.getFilename?.() ?? ''
    // TypeScript file extension: `.cts`, `.mts`, `.ts`, or `.tsx`.
    const nonNullAssertion = /\.(?:cts|mts|tsx?)$/.test(filename) ? '!' : ''

    // Scope-aware kind resolver. Shared with no-cached-for-on-iterable
    // via lib/iterable-kind.mts. We use it to SKIP rewriting
    // `for (const item of setVar)` into the cached-length shape —
    // that would silently no-op the loop (no .length, not integer-
    // indexable) and is exactly the bug the other rule catches.
    const resolveKind = createKindResolver()

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
        // Scope-aware counter: an explicit index param is already a bound name
        // (safe); otherwise pick one colliding with neither the item nor a body
        // identifier. Skip (report, no fix) when no safe counter exists or the
        // body uses `length` — the `{ length } = arr` head would shadow it.
        const indexName = indexParam
          ? indexParam.name
          : pickCounterName(itemName, bodyText)
        if (!indexName || referencesIdentifier(bodyText, 'length')) {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: '.forEach',
              reason:
                'a `for` counter or the `{ length }` binding would collide with an identifier the callback body already uses',
            },
          })
          return
        }
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
            // `!` non-null assertion on the indexed access, TypeScript
            // files only (see `nonNullAssertion` above) — under
            // `noUncheckedIndexedAccess` the lookup returns `T |
            // undefined`, and every read of `${itemName}` downstream
            // would trip TS18048. Emitting it into a plain JS file would
            // be a SyntaxError, so JS files get the same rewrite without
            // the assertion.
            // Emit oxfmt-clean output directly: terminate the item declaration
            // only when the body's first statement is an ASI hazard, and trim
            // the body's trailing whitespace so the closing brace gains no blank
            // line.
            const asiGuard = ASI_HAZARD_LEAD.test(
              bodyInner.trimStart().charAt(0),
            )
              ? ';'
              : ''
            const replacement = `for (let ${indexName} = 0, { length } = ${iterText}; ${indexName} < length; ${indexName} += 1) {\n${innerIndent}${itemKind} ${itemName} = ${iterText}[${indexName}]${nonNullAssertion}${asiGuard}${bodyInner.trimEnd()}\n${indent}}`
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
          // Destructured loop var — typically Map/Set/.entries()
          // iteration where there's no cached-for-loop equivalent.
          // Skip silently rather than emit an unfixable warning.
          return
        }
        const iter = node.right
        // A CallExpression iterable that provably yields an array
        // (`Object.keys(x)`, `names.toSorted()`, `s.split('\n')`) is a real
        // finding, but the fix needs the call hoisted to a local first —
        // report without autofix so the human owns the hoist.
        if (iter.type === 'CallExpression') {
          if (classifyInit(iter) === 'array') {
            context.report({
              node,
              messageId: 'preferCachedForNoFix',
              data: {
                shape: 'for…of over an array-producing call',
                reason:
                  'hoist the call to a local (`const items = …`) so the loop can cache its length',
              },
            })
          }
          return
        }
        // Otherwise the iterable must be a bare Identifier — for a
        // MemberExpression we don't know if it's a (cheap) array indexing
        // target. Skip silently rather than nag.
        if (iter.type !== 'Identifier') {
          return
        }
        // SKIP when the iterable is a known Set / Map / Iterable —
        // rewriting `for (const item of setVar)` to the cached-length
        // shape produces a silent no-op (Set has no .length, isn't
        // integer-indexable). The companion rule
        // socket/no-cached-for-on-iterable would then flag what THIS
        // rule just wrote. Skip silently rather than fight ourselves.
        //
        // Also skip when the kind can't be determined from the AST
        // (e.g. `await fn()` / `someCall()` initializers without a
        // type annotation). Without type info we can't prove the
        // iterable is integer-indexable, and autofixing produces
        // broken code (Set.length / Set[i]) on the wrong guess.
        // Require explicit array shape (literal, type annotation,
        // Array.from, Object.keys/values/entries) to opt in.
        const iterKind = resolveKind(node, iter.name as string)
        if (FLAGGED_KINDS.has(iterKind) || iterKind === 'unknown') {
          return
        }
        if (node.body.type !== 'BlockStatement') {
          // for (x of y) statement; rare. Skip.
          return
        }

        const itemName = declarator.id.name
        const iterText = iter.name
        // Scope-aware counter: pick one colliding with neither the loop var nor
        // a body identifier; skip (report, no fix) when none is free or the body
        // uses `length` — the `{ length } = arr` head would shadow it. This is
        // the collision that silently broke a body already binding its own `i`.
        const forOfBodyText = sourceCode.getText(node.body)
        const counterName = pickCounterName(itemName, forOfBodyText)
        if (!counterName || referencesIdentifier(forOfBodyText, 'length')) {
          context.report({
            node,
            messageId: 'preferCachedForNoFix',
            data: {
              shape: 'for...of',
              reason:
                'a `for` counter or the `{ length }` binding would collide with an identifier the loop body already uses',
            },
          })
          return
        }
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
            // `!` non-null assertion, TypeScript files only — see the
            // sibling .forEach branch for the rationale.
            // Emit oxfmt-clean output directly (see the .forEach branch): a `;`
            // only for an ASI-hazard body head, and no trailing blank line.
            const asiGuard = ASI_HAZARD_LEAD.test(
              bodyInner.trimStart().charAt(0),
            )
              ? ';'
              : ''
            const replacement = `for (let ${counterName} = 0, { length } = ${iterText}; ${counterName} < length; ${counterName} += 1) {\n${innerIndent}${itemKind} ${itemName} = ${iterText}[${counterName}]${nonNullAssertion}${asiGuard}${bodyInner.trimEnd()}\n${indent}}`
            return fixer.replaceText(node, replacement)
          },
        })
      },
    }
  },
}

/**
 * A statement whose first character is one of these can merge with the
 * preceding line under ASI (e.g. `arr[i]!` newline `(fn)()` parses as a call).
 * When a loop body's first statement leads with one, the injected item
 * declaration needs an explicit `;` terminator to stay correct under the
 * fleet's no-semicolon style.
 */
const ASI_HAZARD_LEAD = /[([`+\-*/]/

/**
 * Does the loop body text reference `name` as a standalone identifier? A
 * word-boundary textual probe (not a substring match). Conservative: a false
 * positive only forces a different counter name or a skip — both safe.
 */
export function referencesIdentifier(bodyText: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(String.raw`\b${escaped}\b`).test(bodyText)
}

/**
 * Pick a loop-counter name that collides with neither the item variable NOR any
 * identifier the loop body already uses (scope-aware). Tries `i`, then
 * `i2`…`i9`. Returns `undefined` when every candidate is taken so the caller
 * skips the autofix rather than shadow a live binding — the collision that made
 * a naive `i` rewrite silently break a body that already bound its own `i`.
 * `bodyText` defaults to '' so a name-only call still dodges the item name.
 */
export function pickCounterName(
  itemName: string,
  bodyText = '',
): string | undefined {
  const candidates = ['i', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9']
  for (let idx = 0, { length } = candidates; idx < length; idx += 1) {
    const name = candidates[idx]!
    if (name !== itemName && !referencesIdentifier(bodyText, name)) {
      return name
    }
  }
  return undefined
}

/**
 * Textual check: does the loop body reassign the named identifier? Catches
 * `name = ...`, `name +=`, `name++`, `++name`, etc., and
 * destructuring-as-assignment patterns. Conservative: false positives only
 * force `let` (semantically safe), false negatives trip `no-const-assign` (the
 * bug this guards against).
 *
 * AST-walking would be more precise but oxlint's plugin host doesn't expose a
 * uniform visitor for body subtrees here; the regex catches every reassignment
 * shape that compiles today.
 */
export function reassignsInBody(
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
 * Recover the indentation prefix on the line where `node` starts so the
 * rewritten block can re-indent its contents consistently with the surrounding
 * code.
 */
export function leadingIndent(sourceCode: AstNode, node: AstNode): string {
  const text = sourceCode.text
  const start = node.range[0]
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const indent = text.slice(lineStart, start)
  // Strip non-whitespace (in case the line has content before this
  // statement). Indent is the leading-whitespace prefix only.
  // /^\s*/ always matches (zero-length match guaranteed), so exec() is never null.
  /* c8 ignore next */
  return /^\s*/.exec(indent)?.[0] ?? ''
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
