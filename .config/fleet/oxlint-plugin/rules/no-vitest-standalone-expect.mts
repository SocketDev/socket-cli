/**
 * @file Flag `expect(...)` assertions that sit OUTSIDE any `it` / `test` block
 *   (a "standalone expect"). An assertion in `describe` body scope, at module
 *   top level, or in a hook runs at collection time or once — not as part of a
 *   test case — so a failure is mis-attributed or silently ignored. The fleet
 *   survey found zero today; this guard keeps it that way. An `expect` inside a
 *   hook (`beforeEach`) is allowed (a common setup-assertion pattern). Scope:
 *   `*.test.*`. Report-only. Ported from `@vitest/eslint-plugin`'s
 *   `no-standalone-expect`, on lib/vitest-fn-call.mts.
 */

import { TEST_FILE_RE } from '../lib/test-file.mts'
import {
  classifyVitestCall,
  collectVitestNames,
} from '../lib/vitest-fn-call.mts'

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow expect() outside an it()/test() block (or hook) — a standalone assertion runs at collection time and its failure is mis-attributed.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      standalone:
        '`expect(...)` here is not inside an `it()` / `test()` (or hook) — it runs at collection time, not as a test assertion. Move it into a test case.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!TEST_FILE_RE.test(filename)) {
      return {}
    }
    let names: Map<string, string> | undefined
    // Depth of enclosing test/hook callback function scopes. expect() is valid
    // when > 0.
    let testFnDepth = 0
    // Stack tracking whether each entered function is a test/hook callback.
    const fnStack: boolean[] = []

    // Is this function node the direct callback argument of a test/hook call?
    function isTestOrHookCallback(fn: AstNode): boolean {
      const parent: AstNode | undefined = fn.parent
      if (parent?.type !== 'CallExpression' || !names) {
        return false
      }
      const call = classifyVitestCall(parent, names)
      return !!call && (call.kind === 'test' || call.kind === 'hook')
    }

    function enterFn(fn: AstNode): void {
      const isTest = isTestOrHookCallback(fn)
      fnStack.push(isTest)
      if (isTest) {
        testFnDepth += 1
      }
    }
    function exitFn(): void {
      const wasTest = fnStack.pop()
      if (wasTest) {
        testFnDepth -= 1
      }
    }

    return {
      Program(program: AstNode) {
        names = collectVitestNames(program).names
      },
      FunctionExpression: enterFn,
      'FunctionExpression:exit': exitFn,
      ArrowFunctionExpression: enterFn,
      'ArrowFunctionExpression:exit': exitFn,
      FunctionDeclaration: enterFn,
      'FunctionDeclaration:exit': exitFn,
      CallExpression(node: AstNode) {
        if (!names) {
          return
        }
        const call = classifyVitestCall(node, names)
        // Only the bare `expect(actual)` root call matters (not the matcher
        // chain calls, which classify the same root).
        if (
          call?.kind === 'expect' &&
          node.callee?.type === 'Identifier' &&
          testFnDepth === 0
        ) {
          context.report({ node, messageId: 'standalone' })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
