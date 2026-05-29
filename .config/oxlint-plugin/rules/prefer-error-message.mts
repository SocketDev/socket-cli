/**
 * @file Flag the `<id> instanceof Error ? <id>.message : String(<id>)` ternary
 *   and prefer the `errorMessage` helper from `@socketsecurity/lib/errors`. The
 *   helper short-circuits the same shape, handles `aggregate` / cause chaining
 *   the bare ternary doesn't, and keeps every call site identical so a future
 *   change (adding cause chains, redacting tokens, etc.) lands in one place.
 *   The ternary form gets reinvented in nearly every error-handling branch, so
 *   the linter is the right surface to catch it. Report-only — no autofix. The
 *   rewrite to `errorMessage(<id>)` looks mechanical but the right import path
 *   depends on the file's context: a runtime source file in a downstream repo
 *   wants `@socketsecurity/lib/errors` (catalog), a script / test / hook in the
 *   same repo wants `@socketsecurity/lib-stable/errors` (devDep), and a repo
 *   that doesn't depend on `@socketsecurity/lib` at all can't apply the rewrite
 *   without first adding the dep. None of those choices belong to the linter.
 *   Surface the smell, let the human pick the import line. The rule
 *   deliberately does not chase any of the harder variants (`e?.message ??
 *   String(e)`, `typeof e === 'string' ? e : ...`, `'message' in e ? e.message
 *   : String(e)`) because each carries different semantics — only the
 *   `instanceof Error` form is unambiguously equivalent to `errorMessage(e)`.
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

function identifierName(node: AstNode | undefined): string | undefined {
  if (!node || node.type !== 'Identifier') {
    return undefined
  }
  return node.name
}

function isStringCallOf(node: AstNode | undefined, name: string): boolean {
  if (!node || node.type !== 'CallExpression') {
    return false
  }
  const callee = node.callee
  if (!callee || callee.type !== 'Identifier' || callee.name !== 'String') {
    return false
  }
  const args = node.arguments ?? []
  if (args.length !== 1) {
    return false
  }
  return identifierName(args[0]) === name
}

function isMessageMemberOf(node: AstNode | undefined, name: string): boolean {
  if (!node || node.type !== 'MemberExpression') {
    return false
  }
  if (node.computed) {
    return false
  }
  const property = node.property
  if (
    !property ||
    property.type !== 'Identifier' ||
    property.name !== 'message'
  ) {
    return false
  }
  return identifierName(node.object) === name
}

function isInstanceOfErrorOf(node: AstNode | undefined, name: string): boolean {
  if (!node || node.type !== 'BinaryExpression') {
    return false
  }
  if (node.operator !== 'instanceof') {
    return false
  }
  if (identifierName(node.left) !== name) {
    return false
  }
  return identifierName(node.right) === 'Error'
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer `errorMessage(e)` from `@socketsecurity/lib/errors` over the `e instanceof Error ? e.message : String(e)` ternary.',
      category: 'Stylistic Issues',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      preferErrorMessage:
        '`{{name}} instanceof Error ? {{name}}.message : String({{name}})` reinvents `errorMessage({{name}})` from `@socketsecurity/lib/errors`. Replace with `errorMessage({{name}})` and add the import — `@socketsecurity/lib/errors` for runtime source, `@socketsecurity/lib-stable/errors` for scripts / tests / hooks.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      ConditionalExpression(node: AstNode) {
        const test = node.test
        if (!test || test.type !== 'BinaryExpression') {
          return
        }
        const name = identifierName(test.left)
        if (!name) {
          return
        }
        if (!isInstanceOfErrorOf(test, name)) {
          return
        }
        if (!isMessageMemberOf(node.consequent, name)) {
          return
        }
        if (!isStringCallOf(node.alternate, name)) {
          return
        }
        context.report({
          node,
          messageId: 'preferErrorMessage',
          data: { name },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
