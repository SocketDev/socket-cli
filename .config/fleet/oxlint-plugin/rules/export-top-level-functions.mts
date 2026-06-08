/**
 * @file Require every top-level declaration — `function`, `interface`, `type`
 *   alias, and `class` — to be `export`ed. Per the fleet rule "Export
 *   everything; privacy is handled by NOT importing, never by leaving a symbol
 *   unexported." Exposing internal helpers + types as named exports lets tests
 *   import them directly, no `__test_only__` shim or per-test rebuild. Scope:
 *   top-level declarations only (not class methods, not arrow functions
 *   assigned to const, not local nested declarations). Local helpers and
 *   arrow-as-const are visible to their parent module's tests via the parent;
 *   only the top-level surface needs explicit export. Allowed exceptions
 *   (skipped):
 *
 *   - A function named `main` (script entrypoint convention). Autofix: prepends
 *     `export ` to the declaration when it isn't already named in a sibling
 *     `export { ... }` statement. If a named-re-export already exists, report
 *     without autofix (the human picks: keep the named-re-export shape, or
 *     collapse to the inline `export`).
 */

import path from 'node:path'

import { detectSourceType } from '../lib/detect-source-type.mts'
import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const SCRIPT_ENTRY_NAMES = new Set(['main'])

/**
 * Walk Program body once and collect names exported via: - `export { foo, bar
 * }` - `export { foo as bar }` (the local-name `foo` counts) - `export default
 * foo`
 *
 * Function declarations that already say `export function foo` won't reach this
 * rule's visitor (the visitor matches bare function declarations only via
 * `Program > FunctionDeclaration`; an `ExportNamedDeclaration` wraps them in a
 * different shape).
 */
function collectExportedNames(program: AstNode): Set<string> {
  const exported = new Set<string>()
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

/**
 * @type {import('eslint').Rule.RuleModule}
 */
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
        'Top-level {{kind}} `{{name}}` should be exported (`export {{kind}} {{name}}`). Exporting the top-level surface makes it directly importable + testable; privacy is handled by not importing, not by leaving it unexported.',
      missingAlreadyReExported:
        'Top-level {{kind}} `{{name}}` is named in a separate `export {{ }}` statement; collapse to inline `export {{kind}} {{name}}` for clarity (autofix skipped to avoid creating a duplicate export).',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    // Skip CommonJS files. Rewriting `function getObject(idx) { … }`
    // to `export function getObject(idx) { … }` inside a CJS module
    // makes the file syntactically ESM — `require()` of it then
    // throws `SyntaxError: Unexpected token 'export'`. Worked example:
    // wasm-bindgen `--target nodejs` output (`acorn-bindgen.cjs`)
    // uses `module.exports` for the public surface plus local
    // `function` declarations for internal helpers; the autofix
    // catastrophically rewrote them. The detector uses Node's
    // `--experimental-detect-module` algorithm: file extension is
    // authoritative for `.cjs` / `.cts` / `.mjs` / `.mts`; ambiguous
    // `.js` / `.ts` falls through to a content sniff.
    const filename: string =
      typeof context.filename === 'string'
        ? context.filename
        : typeof context.getFilename === 'function'
          ? context.getFilename()
          : ''
    const extension = filename ? path.extname(filename) : ''
    const sourceText: string =
      typeof sourceCode.getText === 'function'
        ? sourceCode.getText()
        : typeof sourceCode.text === 'string'
          ? sourceCode.text
          : ''
    const kind = detectSourceType(sourceText, { extension })
    if (kind === 'cjs') {
      return {}
    }

    let exportedNames: Set<string> | undefined

    // Shared handler for every top-level declaration shape. `kind` is the
    // human label used in the message + autofix (`function`/`interface`/
    // `type`/`class`); `allowMain` exempts the `main` script-entry convention,
    // which only applies to functions.
    function check(node: AstNode, kind: string, allowMain: boolean): void {
      if (!node.id || node.id.type !== 'Identifier') {
        return
      }
      const name = node.id.name
      if (allowMain && SCRIPT_ENTRY_NAMES.has(name)) {
        return
      }
      if (!exportedNames) {
        exportedNames = collectExportedNames(sourceCode.ast)
      }
      if (exportedNames.has(name)) {
        // Already exported via `export { name }` — report without autofix;
        // the human can choose whether to collapse to the inline export.
        context.report({
          node: node.id,
          messageId: 'missingAlreadyReExported',
          data: { kind, name },
        })
        return
      }
      context.report({
        node: node.id,
        messageId: 'missing',
        data: { kind, name },
        fix(fixer: RuleFixer) {
          // Insert `export ` at the declaration's start. Handles `function`,
          // `async function`, `interface`, `type`, and `class` alike.
          return fixer.insertTextBefore(node, 'export ')
        },
      })
    }

    return {
      'Program > FunctionDeclaration'(node: AstNode) {
        check(node, 'function', true)
      },
      'Program > TSInterfaceDeclaration'(node: AstNode) {
        check(node, 'interface', false)
      },
      'Program > TSTypeAliasDeclaration'(node: AstNode) {
        check(node, 'type', false)
      },
      'Program > ClassDeclaration'(node: AstNode) {
        check(node, 'class', false)
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
