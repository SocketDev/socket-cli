/**
 * @file Prefer `vi.mock(import('./path'))` over `vi.mock('./path')`. The raw
 *   string form is not typechecked — rename or move the mocked module and the
 *   string silently goes stale, so the mock no longer applies and the test
 *   passes against the real implementation. The `import(...)` form is a real
 *   dynamic-import expression: TypeScript resolves it, so a rename/move is a
 *   compile error instead of a silent miss. vitest treats both identically at
 *   runtime (it statically extracts the specifier), so the rewrite is safe.
 *   Applies to `vi.mock` / `vi.doMock` / `vi.unmock` / `vi.doUnmock` and the
 *   `vitest.*` aliases. Autofix wraps the string literal in `import(...)`.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

const MOCK_OBJECTS = new Set(['vi', 'vitest'])
const MOCK_METHODS = new Set(['doMock', 'doUnmock', 'mock', 'unmock'])

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Prefer vi.mock(import('./path')) over vi.mock('./path') so module renames/moves are typechecked, not silently stale.",
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      preferImport:
        "Use `{{call}}(import('{{path}}'))` instead of `{{call}}('{{path}}')`. The raw string isn't typechecked — a rename or move of the mocked module goes stale silently and the mock stops applying. The import() form is resolved by TypeScript, so a move is a compile error.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression') {
          return
        }
        if (
          callee.object.type !== 'Identifier' ||
          !MOCK_OBJECTS.has(callee.object.name)
        ) {
          return
        }
        if (
          callee.property.type !== 'Identifier' ||
          !MOCK_METHODS.has(callee.property.name)
        ) {
          return
        }
        const firstArg = node.arguments[0]
        // Only the raw string-literal form is the antipattern. An
        // already-`import(...)` arg, a template literal, or an identifier
        // is left alone.
        if (
          !firstArg ||
          firstArg.type !== 'Literal' ||
          typeof firstArg.value !== 'string'
        ) {
          return
        }
        const call = `${callee.object.name}.${callee.property.name}`
        context.report({
          node: firstArg,
          messageId: 'preferImport',
          data: { call, path: firstArg.value },
          fix(fixer: RuleFixer) {
            const sourceCode = context.getSourceCode
              ? context.getSourceCode()
              : context.sourceCode
            const raw = sourceCode.getText(firstArg)
            return fixer.replaceText(firstArg, `import(${raw})`)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
