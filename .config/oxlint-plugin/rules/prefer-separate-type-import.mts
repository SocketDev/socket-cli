/**
 * @fileoverview Forbid inline type specifiers (`import { type X, Y }`)
 * — split into a dedicated `import type { X }` plus a value-only
 * `import { Y }`. Two style benefits:
 *
 *   1. The reader sees the type-vs-value split at the import header
 *      without parsing per-specifier `type` keywords.
 *   2. Sorted-imports rules can group `import type` statements
 *      separately from value imports (fleet convention is value
 *      imports first, then types as a trailing block).
 *
 * Style signal that motivated the rule: across the fleet's six
 * surveyed repos, separate `import type` statements outnumber inline
 * `type` specifiers ~200-to-1 (socket-cli: 535 separate vs 2 inline;
 * socket-lib: 212 vs 8). The stragglers are drift, not a different
 * convention.
 *
 * Autofix:
 *   - Inline `type` specifiers in a `import { ... } from 'mod'`
 *     statement are moved into a new `import type { ... } from 'mod'`
 *     statement inserted directly after the original import. The
 *     `type` keyword is stripped from the inline specifier.
 *   - If ALL specifiers in an import are `type`-prefixed, the whole
 *     statement is converted in place to `import type { ... }`.
 *   - Default + type-specifier mixes
 *     (`import Foo, { type Bar } from 'mod'`) are split: default
 *     keeps the original statement, types move to a new
 *     `import type { Bar } from 'mod'` line.
 */

/** @type {import('eslint').Rule.RuleModule} */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer a separate `import type { X }` over inline `import { type X, Y }`.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferSeparateTypeImport:
        'Inline `type` specifier on `{{name}}` — move type-only specifiers into a separate `import type { ... } from "{{source}}"` statement.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    return {
      ImportDeclaration(node: AstNode) {
        // `import type { ... }` at the statement level — already
        // correct, no inline specifiers to surface.
        if (node.importKind === 'type') {
          return
        }
        if (!node.specifiers || node.specifiers.length === 0) {
          return
        }

        const typeSpecifiers: AstNode[] = []
        const valueSpecifiers: AstNode[] = []
        let defaultSpec: AstNode | undefined
        let namespaceSpec: AstNode | undefined
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportDefaultSpecifier') {
            defaultSpec = spec
            continue
          }
          if (spec.type === 'ImportNamespaceSpecifier') {
            namespaceSpec = spec
            continue
          }
          if (spec.type === 'ImportSpecifier') {
            if (spec.importKind === 'type') {
              typeSpecifiers.push(spec)
            } else {
              valueSpecifiers.push(spec)
            }
          }
        }

        if (typeSpecifiers.length === 0) {
          return
        }

        // Report each inline type specifier so the user sees every
        // offender. Attach the autofix to the first one only — ESLint
        // dedupes overlapping fixes and the rewrite replaces the
        // whole statement (plus possibly inserts a new one).
        const source = node.source.value
        const indent = (() => {
          const text = sourceCode.text
          const lineStart = text.lastIndexOf('\n', node.range[0] - 1) + 1
          return text.slice(lineStart, node.range[0])
        })()

        const typeNames = typeSpecifiers
          .map((s: AstNode) => specifierText(sourceCode, s, true))
          .join(', ')

        let fixerAttached = false
        for (const spec of typeSpecifiers) {
          const name =
            spec.imported && spec.imported.name
              ? spec.imported.name
              : '<unknown>'
          const report: {
            node: AstNode
            messageId: string
            data: { name: string; source: string }
            fix?: (fixer: RuleFixer) => unknown
          } = {
            node: spec,
            messageId: 'preferSeparateTypeImport',
            data: { name, source: String(source) },
          }
          if (!fixerAttached) {
            report.fix = function (fixer: RuleFixer) {
              // Case A: every specifier is a type specifier and there's
              // no default/namespace import — convert the whole line.
              if (
                valueSpecifiers.length === 0 &&
                !defaultSpec &&
                !namespaceSpec
              ) {
                const originalText = sourceCode.getText(node)
                const rewritten = originalText
                  .replace(/^import\s+/, 'import type ')
                  // Strip every inline `type ` keyword from inside
                  // the brace list.
                  .replace(/\btype\s+/g, '')
                return fixer.replaceText(node, rewritten)
              }
              // Case B: mixed — keep value/default/namespace
              // specifiers on the original line, append a new
              // `import type { ... } from 'src'` below.
              const remainingParts: string[] = []
              if (defaultSpec) {
                remainingParts.push(sourceCode.getText(defaultSpec))
              }
              if (namespaceSpec) {
                remainingParts.push(sourceCode.getText(namespaceSpec))
              }
              if (valueSpecifiers.length > 0) {
                const valueText = valueSpecifiers
                  .map((s: AstNode) => specifierText(sourceCode, s, false))
                  .join(', ')
                remainingParts.push(`{ ${valueText} }`)
              }
              const quote = sourceCode.text[node.source.range[0]]
              const rewrittenOriginal = `import ${remainingParts.join(', ')} from ${quote}${source}${quote}`
              const newLine = `${indent}import type { ${typeNames} } from ${quote}${source}${quote}`
              return fixer.replaceText(node, `${rewrittenOriginal}\n${newLine}`)
            }
            fixerAttached = true
          }
          context.report(report)
        }
      },
    }
  },
}

/**
 * Render an `ImportSpecifier` for the rewritten statement. When
 * `stripType` is true the `type` keyword is omitted (the specifier
 * is being moved into a statement-level `import type` block, where
 * per-specifier `type` would be redundant).
 */
function specifierText(
  sourceCode: unknown,
  spec: AstNode,
  stripType: boolean,
): string {
  void sourceCode
  const imported = spec.imported
  const local = spec.local
  const importedName =
    imported.type === 'Identifier' ? imported.name : `"${imported.value}"`
  const localName = local.name
  const renamed = importedName !== localName
  const body = renamed ? `${importedName} as ${localName}` : importedName
  if (!stripType && spec.importKind === 'type') {
    return `type ${body}`
  }
  return body
}

export default rule
