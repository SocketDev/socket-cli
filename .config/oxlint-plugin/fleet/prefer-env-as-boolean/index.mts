/**
 * @file Per CLAUDE.md "Environment — boolean coercion": every `SOCKET_*` env
 *   getter (e.g. `getSocketDebug()`) returns `string | undefined`. Truthy
 *   coercion via `!!`, `Boolean(...)`, or `=== 'true'` / `== '1'` is wrong — CI
 *   commonly exports `SOCKET_DEBUG=0` (the string `'0'`) to mean OFF, but
 *   `!!'0'` is `true`. Use `envAsBoolean(v)` from
 *   `@socketsecurity/lib-stable/env/boolean` which treats only `1` / `true` /
 *   `yes` (case-insensitive) as true. Detects:
 *
 *   - `!!getSocket<X>()`
 *   - `Boolean(getSocket<X>())`
 *   - `getSocket<X>() === 'true'` / `=== '1'` / `== 'true'` / `== '1'` …where
 *     `getSocket<X>` is any identifier whose name starts with `getSocket` and
 *     follows the `getSocket<Pascal>` convention used by
 *     `@socketsecurity/lib/env/*`. Name-pattern-based; doesn't follow types.
 *     False-positive rate is low because the fleet doesn't name local getters
 *     `getSocket*`. Autofix: rewrites to `envAsBoolean(<call>)` and adds the
 *     import when missing. Allowed (skip):
 *   - `getDebug()` and other non-`getSocket*` getters — those may legitimately
 *     consume the string value (e.g. the `debug` package's `'socket:*'`
 *     namespace).
 */

import {
  appendImportFixes,
  summarizeImportTarget,
} from '../../_shared/inject-import.mts'

import type { AstNode, RuleContext, RuleFixer } from '../../lib/rule-types.mts'

const TRUTHY_LITERALS = new Set(['1', 'true'])

function isSocketGetterCall(node: AstNode): boolean {
  if (node.type !== 'CallExpression') {
    return false
  }
  const callee = (node as { callee?: AstNode | undefined }).callee
  if (!callee || callee.type !== 'Identifier') {
    return false
  }
  const name = (callee as { name?: string | undefined }).name
  if (!name) {
    return false
  }
  return /^getSocket[A-Z]/.test(name)
}

function isTruthyStringLiteral(node: AstNode): boolean {
  if (node.type !== 'Literal') {
    return false
  }
  const v = (node as { value?: unknown | undefined }).value
  return typeof v === 'string' && TRUTHY_LITERALS.has(v)
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use envAsBoolean from @socketsecurity/lib-stable/env/boolean for SOCKET_* env coercion. Truthy coercion misclassifies the string "0" as true.',
      category: 'Possible Errors',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      coerce:
        '`{{shape}}` misclassifies the string "0" / "false" as truthy. Use `envAsBoolean({{inner}})` from @socketsecurity/lib-stable/env/boolean.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    let summary: ReturnType<typeof summarizeImportTarget> | undefined

    function ensureSummary() {
      if (!summary) {
        // localName so a file with its own `envAsBoolean` binding is detected.
        summary = summarizeImportTarget(
          sourceCode.ast,
          'envAsBoolean',
          'envAsBoolean',
        )
      }
      return summary
    }

    function reportAndFix(
      node: AstNode,
      shape: string,
      innerExpr: AstNode,
    ): void {
      const innerText = sourceCode.getText(innerExpr)
      const s = ensureSummary()
      // A local `envAsBoolean` binding means the rewrite would resolve to it,
      // not the lib, and the import would collide — report without a fix.
      if (s.hasLocal) {
        context.report({
          node,
          messageId: 'coerce',
          data: { shape, inner: innerText },
        })
        return
      }
      context.report({
        node,
        messageId: 'coerce',
        data: { shape, inner: innerText },
        fix(fixer: RuleFixer) {
          return [
            fixer.replaceText(node, `envAsBoolean(${innerText})`),
            ...appendImportFixes(
              s,
              fixer,
              `import { envAsBoolean } from '@socketsecurity/lib-stable/env/boolean'`,
              undefined,
            ),
          ]
        },
      })
    }

    return {
      UnaryExpression(node: AstNode) {
        if ((node as { operator?: string | undefined }).operator !== '!') {
          return
        }
        const arg = (node as { argument?: AstNode | undefined }).argument
        if (
          !arg ||
          arg.type !== 'UnaryExpression' ||
          (arg as { operator?: string | undefined }).operator !== '!'
        ) {
          return
        }
        const inner = (arg as { argument?: AstNode | undefined }).argument
        if (!inner || !isSocketGetterCall(inner)) {
          return
        }
        reportAndFix(node, '!!getSocketX()', inner)
      },

      CallExpression(node: AstNode) {
        const callee = (node as { callee?: AstNode | undefined }).callee
        if (
          !callee ||
          callee.type !== 'Identifier' ||
          (callee as { name?: string | undefined }).name !== 'Boolean'
        ) {
          return
        }
        const args =
          (node as { arguments?: AstNode[] | undefined }).arguments ?? []
        if (args.length !== 1) {
          return
        }
        const arg = args[0]!
        if (!isSocketGetterCall(arg)) {
          return
        }
        reportAndFix(node, 'Boolean(getSocketX())', arg)
      },

      BinaryExpression(node: AstNode) {
        const op = (node as { operator?: string | undefined }).operator
        if (op !== '==' && op !== '===') {
          return
        }
        const left = (node as { left?: AstNode | undefined }).left
        const right = (node as { right?: AstNode | undefined }).right
        if (!left || !right) {
          return
        }
        if (isSocketGetterCall(left) && isTruthyStringLiteral(right)) {
          reportAndFix(node, `getSocketX() ${op} '<literal>'`, left)
          return
        }
        if (isSocketGetterCall(right) && isTruthyStringLiteral(left)) {
          reportAndFix(node, `'<literal>' ${op} getSocketX()`, right)
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
