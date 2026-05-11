/**
 * @fileoverview Forbid `export default` — fleet convention is named
 * exports only. Default exports lose the name at the import site
 * (`import x from 'mod'` lets the caller rename freely), defeat
 * grep / "find references" tools, and don't compose with re-exports
 * (`export * from 'mod'` skips the default).
 *
 * Style signal that motivated the rule: across socket-sdk-js,
 * socket-cli, socket-packageurl-js, socket-sdxgen, socket-lib, and
 * socket-stuie, the named-vs-default ratio is essentially
 * 100-to-1 — socket-lib has zero `export default` statements, the
 * other repos have a handful of stragglers each.
 *
 * Autofix scope:
 *   - `export default function foo() {}` → `export function foo() {}`
 *   - `export default class Foo {}` → `export class Foo {}`
 *   - `export default <identifier>` (separate-declaration form) →
 *     `export { <identifier> }`
 *
 * Skips (report-only, no fix):
 *   - `export default function () {}` / `export default class {}` —
 *     anonymous declarations, no canonical name to assign.
 *   - `export default <expression>` where the expression isn't a bare
 *     identifier (e.g. `export default { foo: 1 }`,
 *     `export default makePlugin(...)`) — choosing a name requires
 *     human input.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Forbid `export default` — use named exports so the export name is stable across import sites.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      noDefaultExport:
        'Avoid `export default` — use a named export so the export name is stable across imports, greppable, and composable with `export * from`.',
      noDefaultExportNoFix:
        'Avoid `export default` — the default-exported value is anonymous or a complex expression. Give it a name and switch to `export { <name> }`.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    return {
      ExportDefaultDeclaration(node) {
        const decl = node.declaration
        if (!decl) {
          return
        }

        // `export default function name() {}` /
        // `export default class Name {}` — drop the `default` keyword
        // and emit the declaration as a named export.
        if (
          (decl.type === 'FunctionDeclaration' ||
            decl.type === 'ClassDeclaration') &&
          decl.id &&
          decl.id.type === 'Identifier'
        ) {
          context.report({
            node,
            messageId: 'noDefaultExport',
            fix(fixer) {
              const declText = sourceCode.getText(decl)
              return fixer.replaceText(node, `export ${declText}`)
            },
          })
          return
        }

        // `export default someIdentifier` — rewrite to
        // `export { someIdentifier }`. Only safe when the identifier
        // is declared in the same module; we don't try to verify that
        // here because the import side will fail loudly if not, and
        // the autofix never strips a declaration.
        if (decl.type === 'Identifier') {
          context.report({
            node,
            messageId: 'noDefaultExport',
            fix(fixer) {
              return fixer.replaceText(node, `export { ${decl.name} }`)
            },
          })
          return
        }

        // Anonymous declaration or complex expression — report without
        // a fix; the human needs to choose a name.
        context.report({
          node,
          messageId: 'noDefaultExportNoFix',
        })
      },
    }
  },
}

export default rule
