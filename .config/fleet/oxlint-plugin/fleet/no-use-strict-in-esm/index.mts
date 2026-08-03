/**
 * @file Forbid a `'use strict'` directive in ES modules (`.mjs` / `.mts`). ES
 *   modules are strict by default — the directive is dead noise that implies
 *   the file might NOT otherwise be strict, which misleads a reader. It only
 *   ever does anything in a classic script / CommonJS module, so its presence
 *   in an ESM file is always a mistake (usually a copy-paste from a `.cjs` file
 *   or a script template). Scope: files with a `.mjs` / `.mts` extension
 *   (authoritatively ESM); `.js` / `.ts` / `.cjs` / `.cts` are left alone (a
 *   `.cjs` is legitimately a script where `'use strict'` is meaningful, and
 *   ambiguous `.js`/`.ts` may be compiled as a script). Autofix removes the
 *   directive statement.
 */

import path from 'node:path'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

// Extensions that are unambiguously ES modules.
const ESM_EXT = new Set(['.mjs', '.mts'])

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        "Forbid `'use strict'` in ES modules (.mjs/.mts) — modules are strict by default.",
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      useStrictInEsm:
        "`'use strict'` is redundant in an ES module (.mjs/.mts are strict by default). Remove it — keeping it implies the file might not be strict, which misleads the reader.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename: string =
      typeof context.filename === 'string'
        ? context.filename
        : typeof context.getFilename === 'function'
          ? context.getFilename()
          : ''
    const extension = filename ? path.extname(filename) : ''
    if (!ESM_EXT.has(extension)) {
      return {}
    }

    return {
      // A directive is an ExpressionStatement whose expression is a string
      // literal. `'use strict'` is only meaningful as a leading directive, but
      // flag it anywhere in an ESM file — it's redundant in every position.
      ExpressionStatement(node: AstNode) {
        const expr = node.expression
        if (
          !expr ||
          expr.type !== 'Literal' ||
          typeof expr.value !== 'string' ||
          expr.value !== 'use strict'
        ) {
          return
        }
        context.report({
          node,
          messageId: 'useStrictInEsm',
          fix(fixer: RuleFixer) {
            return fixer.remove(node)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
