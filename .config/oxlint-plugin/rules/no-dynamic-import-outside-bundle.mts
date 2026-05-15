/**
 * @fileoverview Ban dynamic `import()` (ImportExpression) in code that
 * isn't bundled. The fleet favors static ES6 imports — dynamic import
 * is only meaningful when a bundler resolves it statically at build
 * time. Scripts under `scripts/` run directly via `node`; nothing
 * bundles them, so a dynamic import only adds a runtime async hop for
 * no resolution win.
 *
 * Allowed paths: `src/**`, `.config/**` (bundler configs themselves
 * may load tools dynamically via the bundler's API).
 *
 * No autofix: converting `await import('foo')` to `import 'foo'`
 * requires moving the statement to the top of the file and removing
 * `await`/destructuring — the bundler-aware AST rewrite is non-trivial
 * to do safely. Reporting only.
 */

import path from 'node:path'

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const DEFAULT_BUNDLED_ROOTS = ['src/', '.config/', 'packages/']

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban dynamic import() outside bundled trees (src/, .config/, packages/).',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      dynamic:
        'Dynamic import() in {{file}} — favor a static `import` statement at the top of the file. Dynamic import is only valid in bundled code (src/, .config/, packages/). If lazy resolution is required, justify it explicitly.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          bundledRoots: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Path prefixes (relative to repo root) where dynamic import() is allowed.',
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context: RuleContext) {
    const options = context.options[0] || {}
    const bundledRoots = options.bundledRoots || DEFAULT_BUNDLED_ROOTS
    const filename = context.physicalFilename || context.filename
    const cwd = context.cwd || process.cwd()
    const relative = path.relative(cwd, filename).split(path.sep).join('/')

    const inBundled = bundledRoots.some((root: string) =>
      relative.startsWith(root),
    )

    if (inBundled) {
      return {}
    }

    return {
      ImportExpression(node: AstNode) {
        context.report({
          node,
          messageId: 'dynamic',
          data: { file: relative },
        })
      },
    }
  },
}

export default rule
