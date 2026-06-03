/**
 * @file Flag duplicate test/describe titles within the SAME describe scope —
 *   two `it('does X', …)` with the identical title, or two sibling
 *   `describe('group', …)`. The fleet leans on describe-nesting for
 *   uniqueness, so a flattened duplicate slips by silently: the runner shows
 *   two identically-named cases and it's ambiguous which failed. Titles are
 *   compared per enclosing describe scope (siblings only), so the same title in
 *   two different groups is fine. Only string-literal / template-without-
 *   substitution titles are compared (a dynamic title can't be statically
 *   deduped). Scope: `*.test.*`. Report-only. Ported from
 *   `@vitest/eslint-plugin`'s `no-identical-title`, on lib/vitest-fn-call.mts.
 */

import {
  classifyVitestCall,
  collectVitestNames,
} from '../lib/vitest-fn-call.mts'

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const TEST_FILE_RE = /\.test\.(?:[mc]?[jt]s)$/

// Extract a static string title from the first argument, or undefined when the
// title is dynamic (identifier, template with substitutions, expression).
function staticTitle(node: AstNode): string | undefined {
  const arg = node.arguments?.[0] as AstNode | undefined
  if (!arg) {
    return undefined
  }
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    return arg.value
  }
  if (
    arg.type === 'TemplateLiteral' &&
    Array.isArray(arg.expressions) &&
    arg.expressions.length === 0 &&
    Array.isArray(arg.quasis) &&
    arg.quasis.length === 1
  ) {
    return String(arg.quasis[0]?.value?.cooked ?? arg.quasis[0]?.value?.raw ?? '')
  }
  return undefined
}

interface Scope {
  tests: Set<string>
  describes: Set<string>
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow duplicate test/describe titles within the same describe scope — a flattened duplicate makes failures ambiguous.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      duplicate:
        'Duplicate {{ kind }} title "{{ title }}" in this scope. Two same-named {{ kind }}s make a failure ambiguous — rename one or nest them under distinct `describe` groups.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!TEST_FILE_RE.test(filename)) {
      return {}
    }
    let names: Map<string, string> | undefined
    // Stack of describe scopes; index 0 is the file/top scope.
    const scopes: Scope[] = [{ tests: new Set(), describes: new Set() }]

    function currentScope(): Scope {
      return scopes[scopes.length - 1]!
    }

    // Is this function the callback of a describe call? Push a scope on enter.
    function maybeEnterDescribe(fn: AstNode): void {
      const parent: AstNode | undefined = fn.parent
      if (parent?.type === 'CallExpression' && names) {
        const call = classifyVitestCall(parent, names)
        if (call?.kind === 'describe') {
          scopes.push({ tests: new Set(), describes: new Set() })
        }
      }
    }
    function maybeExitDescribe(fn: AstNode): void {
      const parent: AstNode | undefined = fn.parent
      if (parent?.type === 'CallExpression' && names) {
        const call = classifyVitestCall(parent, names)
        if (call?.kind === 'describe' && scopes.length > 1) {
          scopes.pop()
        }
      }
    }

    return {
      Program(program: AstNode) {
        names = collectVitestNames(program).names
      },
      'FunctionExpression': maybeEnterDescribe,
      'FunctionExpression:exit': maybeExitDescribe,
      'ArrowFunctionExpression': maybeEnterDescribe,
      'ArrowFunctionExpression:exit': maybeExitDescribe,
      CallExpression(node: AstNode) {
        if (!names) {
          return
        }
        const call = classifyVitestCall(node, names)
        if (!call || (call.kind !== 'test' && call.kind !== 'describe')) {
          return
        }
        // `.each` / `.for` parametrize the title — never a static duplicate.
        if (call.modifiers.includes('each') || call.modifiers.includes('for')) {
          return
        }
        const title = staticTitle(node)
        if (title === undefined) {
          return
        }
        const scope = currentScope()
        const bucket = call.kind === 'test' ? scope.tests : scope.describes
        if (bucket.has(title)) {
          context.report({
            node,
            messageId: 'duplicate',
            data: { kind: call.kind, title },
          })
        } else {
          bucket.add(title)
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
