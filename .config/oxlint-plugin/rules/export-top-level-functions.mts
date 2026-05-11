/**
 * @fileoverview Require every top-level `function` declaration to be
 * `export`ed. Per the fleet rule: "we should export all methods for
 * testing." Exposing internal helpers as named exports lets tests
 * import them directly, no `__test_only__` shim or per-test rebuild.
 *
 * Scope: top-level function declarations only (not class methods,
 * not arrow functions assigned to const, not local nested functions).
 * Local helpers and arrow-as-const are visible to their parent
 * module's tests via the parent function; only the top-level surface
 * needs explicit export.
 *
 * Allowed exceptions (skipped):
 *   - The function is named `main` (script entrypoint convention).
 *
 * Autofix: prepends `export ` to the function declaration when the
 * function isn't already named in a sibling `export { ... }`
 * statement. If a named-re-export already exists, report without
 * autofix (the human picks: keep the named-re-export shape, or
 * collapse to the inline `export function`).
 */

const SCRIPT_ENTRY_NAMES = new Set(['main'])

/**
 * Walk Program body once and collect names exported via:
 *   - `export { foo, bar }`
 *   - `export { foo as bar }` (the local-name `foo` counts)
 *   - `export default foo`
 *
 * Function declarations that already say `export function foo` won't
 * reach this rule's visitor (the visitor matches bare function
 * declarations only via `Program > FunctionDeclaration`; an
 * `ExportNamedDeclaration` wraps them in a different shape).
 */
function collectExportedNames(program) {
  const exported = new Set()
  for (const stmt of program.body) {
    if (stmt.type === 'ExportNamedDeclaration' && !stmt.declaration) {
      // `export { foo, bar as baz }` — count the local name.
      for (const spec of stmt.specifiers) {
        if (spec.local && spec.local.type === 'Identifier') {
          exported.add(spec.local.name)
        }
      }
    }
    if (
      stmt.type === 'ExportDefaultDeclaration' &&
      stmt.declaration &&
      stmt.declaration.type === 'Identifier'
    ) {
      exported.add(stmt.declaration.name)
    }
  }
  return exported
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require top-level function declarations to be exported (testability).',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      missing:
        'Top-level function `{{name}}` should be `export function {{name}}`. Exporting internal helpers makes them directly testable.',
      missingAlreadyReExported:
        'Top-level function `{{name}}` is named in a separate `export {{ }}` statement; collapse to inline `export function {{name}}` for clarity (autofix skipped to avoid creating a duplicate export).',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode
    let exportedNames

    return {
      'Program > FunctionDeclaration'(node) {
        if (!node.id || node.id.type !== 'Identifier') {
          return
        }
        const name = node.id.name
        if (SCRIPT_ENTRY_NAMES.has(name)) {
          return
        }
        if (!exportedNames) {
          exportedNames = collectExportedNames(sourceCode.ast)
        }
        if (exportedNames.has(name)) {
          // Already exported via `export { name }` — report without
          // autofix; the human can choose whether to collapse to the
          // inline export.
          context.report({
            node: node.id,
            messageId: 'missingAlreadyReExported',
            data: { name },
          })
          return
        }
        context.report({
          node: node.id,
          messageId: 'missing',
          data: { name },
          fix(fixer) {
            // Insert `export ` at the function's start. Handles both
            // `function name(...)` and `async function name(...)`.
            return fixer.insertTextBefore(node, 'export ')
          },
        })
      },
    }
  },
}

export default rule
