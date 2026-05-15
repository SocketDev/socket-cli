/**
 * @fileoverview Ban inline `getDefaultLogger().<method>(...)`. The
 * logger must be hoisted at the top of the file:
 *   const logger = getDefaultLogger()
 *   ...
 *   logger.success('...')
 *
 * Inline `getDefaultLogger().success(...)` re-resolves the logger on
 * every call and reads inconsistently. The hoisted form is the
 * fleet-canonical pattern.
 *
 * Autofix: rewrites `getDefaultLogger().<method>` → `logger.<method>`
 * AND inserts the missing pieces in one go:
 *
 *   1. `import { getDefaultLogger } from '@socketsecurity/lib/logger'`
 *      — appended after the last existing top-level import (or at the
 *      top of the file if there are none).
 *   2. `const logger = getDefaultLogger()` — appended after the import
 *      block (so `logger` is hoisted at module scope).
 *
 * Each inline call site emits its own fix independently. ESLint's
 * autofixer dedupes overlapping inserts, so multiple violations in the
 * same file collapse the import + hoist into a single insertion.
 */

import { appendImportFixes, summarizeImportTarget } from './_inject-import.mts'

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const LOGGER_IMPORT_LINE =
  "import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'"
const LOGGER_HOIST_LINE = 'const logger = getDefaultLogger()'

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Hoist getDefaultLogger() to a const at the top of the file; do not call it inline.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      inline:
        'getDefaultLogger() must be hoisted: add `const logger = getDefaultLogger()` near the top of the file and use `logger.{{method}}(...)`.',
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
        // Match: getDefaultLogger().<method>
        if (node.property.type !== 'Identifier') {
          return
        }
        const obj = node.object
        if (
          obj.type !== 'CallExpression' ||
          obj.callee.type !== 'Identifier' ||
          obj.callee.name !== 'getDefaultLogger' ||
          obj.arguments.length !== 0
        ) {
          return
        }

        const s = ensureSummary()

        context.report({
          node,
          messageId: 'inline',
          data: { method: node.property.name },
          fix(fixer: RuleFixer) {
            // Replace `getDefaultLogger()` (the CallExpression) with
            // `logger`. Leaves `.method(...)` intact, so the result is
            // `logger.method(...)`.
            return [
              fixer.replaceText(obj, 'logger'),
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
