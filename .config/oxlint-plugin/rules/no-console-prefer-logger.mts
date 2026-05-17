/**
 * @fileoverview Ban `console.log` / `console.error` / `console.warn`
 * / `console.info` / `console.debug` / `console.trace`. The fleet uses
 * `getDefaultLogger()` from `@socketsecurity/lib-stable/logger` — those
 * methods emit theme-aware coloring + canonical symbols.
 *
 * Autofix: rewrites `console.<method>(...)` → `logger.<loggerMethod>(...)`
 * AND inserts the missing pieces in one go:
 *
 *   1. `import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'`
 *      — appended after the last existing top-level import (or at the
 *      top of the file if there are none).
 *   2. `const logger = getDefaultLogger()` — appended after the import
 *      block (so `logger` is hoisted at module scope).
 *
 * Each `console.<method>(...)` call site emits its own fix
 * independently. ESLint's autofixer dedupes overlapping inserts (the
 * import line + hoist), so the visit order is irrelevant.
 */

import { appendImportFixes, summarizeImportTarget } from './_inject-import.mts'

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const CONSOLE_TO_LOGGER = {
  debug: 'log',
  error: 'fail',
  info: 'info',
  log: 'log',
  trace: 'log',
  warn: 'warn',
}

const LOGGER_IMPORT_LINE =
  "import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'"
const LOGGER_HOIST_LINE = 'const logger = getDefaultLogger()'

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban console.* calls; use logger from @socketsecurity/lib-stable/logger.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      banned:
        'console.{{method}}() — use logger.{{loggerMethod}}() from @socketsecurity/lib-stable/logger.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    let summary: ReturnType<typeof summarizeImportTarget> | undefined

    function ensureSummary() {
      if (summary) {
        return summary
      }
      summary = summarizeImportTarget(
        sourceCode.ast,
        '@socketsecurity/lib-stable/logger',
        'getDefaultLogger',
        'logger',
      )
      return summary
    }

    return {
      MemberExpression(node: AstNode) {
        if (
          node.object.type !== 'Identifier' ||
          node.object.name !== 'console' ||
          node.property.type !== 'Identifier'
        ) {
          return
        }
        const method = node.property.name
        const loggerMethod = (CONSOLE_TO_LOGGER as Record<string, string>)[
          method
        ]
        if (!loggerMethod) {
          return
        }

        // Only flag when console.<method> is the callee of a call
        // (skip e.g. `typeof console.log` or destructuring).
        const parent = node.parent
        if (
          !parent ||
          parent.type !== 'CallExpression' ||
          parent.callee !== node
        ) {
          return
        }

        const s = ensureSummary()

        context.report({
          node,
          messageId: 'banned',
          data: { method, loggerMethod },
          fix(fixer: RuleFixer) {
            return [
              fixer.replaceText(node, `logger.${loggerMethod}`),
              ...appendImportFixes(
                s,
                fixer,
                LOGGER_IMPORT_LINE,
                LOGGER_HOIST_LINE,
              ),
            ]
          },
        })
      },
    }
  },
}

export default rule
