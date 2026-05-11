/**
 * @fileoverview Ban `console.log` / `console.error` / `console.warn`
 * / `console.info` / `console.debug` / `console.trace`. The fleet uses
 * `getDefaultLogger()` from `@socketsecurity/lib/logger` — those
 * methods emit theme-aware coloring + canonical symbols.
 *
 * Autofix: rewrites `console.log(...)` → `logger.log(...)` and
 * similar. Assumes a hoisted `logger` const at the top of the file
 * (the no-inline-logger rule enforces that). If no `logger` import
 * exists, the human can run `pnpm fix` then add the import.
 */

const CONSOLE_TO_LOGGER = {
  log: 'log',
  error: 'fail',
  warn: 'warn',
  info: 'info',
  debug: 'log',
  trace: 'log',
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban console.* calls; use logger from @socketsecurity/lib/logger.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      banned:
        'console.{{method}}() — use logger.{{loggerMethod}}() from @socketsecurity/lib/logger.',
    },
    schema: [],
  },

  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type !== 'Identifier' ||
          node.object.name !== 'console' ||
          node.property.type !== 'Identifier'
        ) {
          return
        }
        const method = node.property.name
        const loggerMethod = CONSOLE_TO_LOGGER[method]
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

        context.report({
          node,
          messageId: 'banned',
          data: { method, loggerMethod },
          fix(fixer) {
            return fixer.replaceText(node, `logger.${loggerMethod}`)
          },
        })
      },
    }
  },
}

export default rule
