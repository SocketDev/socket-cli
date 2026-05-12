/**
 * @fileoverview Module-scope function definitions should use
 * `function foo() {}` declarations, not `const foo = () => {}` or
 * `const foo = function () {}` expressions. Function declarations
 * hoist, sort cleanly under `sort-source-methods`, and render with
 * a stable `foo.name` in stack traces — arrow expressions assigned
 * to `const` lose all three properties (no hoisting, treated as
 * statements by the sort rule, and `.name` is the variable name
 * which is fragile across refactors).
 *
 * Style signal that motivated the rule: across the fleet's six
 * surveyed repos, the ratio of `function` declarations to top-level
 * arrow `const`s is overwhelming — socket-cli 962:5, socket-lib
 * 842:13, socket-sdk-js 200:6. The arrow stragglers are drift.
 *
 * Autofix scope (deterministic only):
 *   - `const foo = () => { ... }` (block body) →
 *     `function foo() { ... }`
 *   - `const foo = (a, b) => expr` (expression body) →
 *     `function foo(a, b) { return expr }`
 *   - `const foo = function (a, b) { ... }` →
 *     `function foo(a, b) { ... }`
 *   - `const foo = async () => { ... }` → `async function foo() {}`
 *   - `export const foo = () => {}` →
 *     `export function foo() {}` (preserves the export)
 *
 * Skips (report-only, no fix):
 *   - Generator function expressions (`function*`) — autofix needs
 *     to insert `*` after `function` without losing the name, and
 *     the construct is rare enough that the human can do it.
 *   - Destructured / non-Identifier declarators
 *     (`const { foo } = ...`, `const [foo] = ...`).
 *   - Multi-declarator `const foo = ..., bar = ...` — splitting
 *     into declarations + function declarations is messy; the
 *     reader should split it manually first.
 *   - Declarations carrying a TS type annotation
 *     (`const foo: Handler = () => {}`) — the annotation is the
 *     contract and would need to migrate to a `satisfies` or be
 *     dropped. Human call.
 *   - Functions that reference `this` — declaration-form `function`
 *     has its own `this`; arrows inherit. Static check: the
 *     function body contains the `this` keyword anywhere.
 *   - Functions inside non-Program scopes (loops, conditionals, etc.)
 *     — only the top-level (Program body) shape is rewritten.
 */

const SKIP_TYPE_ANNOTATION = true

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Module-scope functions should use `function foo() {}` declarations instead of `const foo = () => ...` / `const foo = function () {}`.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferFunctionDeclaration:
        'Module-scope `{{name}}` is an arrow/function expression. Use `function {{name}}() {}` — hoists, sorts under `sort-source-methods`, and renders a stable name in stack traces.',
      preferFunctionDeclarationNoFix:
        'Module-scope `{{name}}` should be a `function` declaration, but autofix is unsafe here (generator / `this` reference / type-annotated declarator / multi-declarator binding). Rewrite manually.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    return {
      VariableDeclaration(node) {
        // Only top-level: Program body, or `export const ...` whose
        // parent is the Program body.
        const parent = node.parent
        const isTopLevel =
          (parent && parent.type === 'Program') ||
          (parent &&
            (parent.type === 'ExportNamedDeclaration' ||
              parent.type === 'ExportDefaultDeclaration') &&
            parent.parent &&
            parent.parent.type === 'Program')
        if (!isTopLevel) {
          return
        }
        if (node.kind !== 'const') {
          return
        }
        if (node.declarations.length !== 1) {
          return
        }

        const decl = node.declarations[0]
        if (!decl.id || decl.id.type !== 'Identifier') {
          return
        }
        if (!decl.init) {
          return
        }
        const init = decl.init
        if (
          init.type !== 'ArrowFunctionExpression' &&
          init.type !== 'FunctionExpression'
        ) {
          return
        }

        const name = decl.id.name

        // Skip generator function expressions — autofix below doesn't
        // re-insert the `*`.
        if (init.generator) {
          context.report({
            node: decl.id,
            messageId: 'preferFunctionDeclarationNoFix',
            data: { name },
          })
          return
        }

        // Skip declarators that carry a type annotation — the
        // annotation needs migration.
        if (SKIP_TYPE_ANNOTATION && decl.id.typeAnnotation) {
          context.report({
            node: decl.id,
            messageId: 'preferFunctionDeclarationNoFix',
            data: { name },
          })
          return
        }

        // Skip if the function body references `this` — declaration
        // form has its own `this`, would change semantics.
        if (init.type === 'ArrowFunctionExpression' && referencesThis(init)) {
          context.report({
            node: decl.id,
            messageId: 'preferFunctionDeclarationNoFix',
            data: { name },
          })
          return
        }

        context.report({
          node: decl.id,
          messageId: 'preferFunctionDeclaration',
          data: { name },
          fix(fixer) {
            const asyncPrefix = init.async ? 'async ' : ''
            const params = init.params
              .map(p => sourceCode.getText(p))
              .join(', ')
            let body
            if (init.body.type === 'BlockStatement') {
              body = sourceCode.getText(init.body)
            } else {
              // Expression body — wrap in a block with `return`.
              body = `{\n  return ${sourceCode.getText(init.body)}\n}`
            }
            const replacement = `${asyncPrefix}function ${name}(${params}) ${body}`
            // Replace the whole VariableDeclaration node (which
            // includes the trailing semicolon if any — the
            // declaration form doesn't take one but oxfmt will
            // normalize on the next pass).
            return fixer.replaceText(node, replacement)
          },
        })
      },
    }
  },
}

/**
 * Walk the function body iteratively looking for a `ThisExpression`.
 *
 * We previously serialized the AST with JSON.stringify + regex on
 * `\bthis\b`, but oxlint's AST nodes can carry back-references
 * (parent, scope, type-arg back-pointers from the TS plugin) via
 * getters that return fresh wrapper objects. A WeakSet de-cycle
 * keyed on object identity misses those cases — the seen-check
 * returns false and JSON.stringify hits the limit and throws
 * "Converting circular structure to JSON," crashing the rule. The
 * AST walk avoids serialization entirely: each visit checks the
 * node's `type` and pushes child nodes onto a work queue. Identity-
 * based seen-set still de-cycles for safety, this time without
 * paying the cost of stringification.
 */
function referencesThis(node) {
  if (!node.body) {
    return false
  }
  const seen = new WeakSet()
  // Inline child-list keys we know the ESTree shape uses. Skip
  // `parent` and other navigational back-refs — anything that's not
  // a structural child of the function body.
  const STRUCTURAL_KEYS = [
    'argument',
    'arguments',
    'body',
    'callee',
    'cases',
    'consequent',
    'declaration',
    'declarations',
    'discriminant',
    'elements',
    'expression',
    'expressions',
    'finalizer',
    'handler',
    'id',
    'init',
    'key',
    'left',
    'object',
    'param',
    'params',
    'properties',
    'property',
    'quasi',
    'quasis',
    'right',
    'specifiers',
    'tag',
    'test',
    'update',
    'value',
  ]
  const queue = [
    node.body.type === 'BlockStatement' ? node.body.body : node.body,
  ]
  while (queue.length > 0) {
    const item = queue.pop()
    if (item === null || item === undefined) {
      continue
    }
    if (Array.isArray(item)) {
      for (let i = 0, { length } = item; i < length; i += 1) {
        queue.push(item[i])
      }
      continue
    }
    if (typeof item !== 'object') {
      continue
    }
    if (seen.has(item)) {
      continue
    }
    seen.add(item)
    if (item.type === 'ThisExpression') {
      return true
    }
    // Don't recurse into nested function-like nodes — they bind
    // their own `this`, so a `this` inside them doesn't count.
    if (
      item.type === 'FunctionExpression' ||
      item.type === 'FunctionDeclaration'
    ) {
      continue
    }
    for (let i = 0, { length } = STRUCTURAL_KEYS; i < length; i += 1) {
      const k = STRUCTURAL_KEYS[i]
      if (k && item[k] !== undefined) {
        queue.push(item[k])
      }
    }
  }
  return false
}

export default rule
