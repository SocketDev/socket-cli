/**
 * @file Flag a test case (`it` / `test`) whose body contains NO assertion. A
 *   test with no `expect(...)` (or recognized assertion helper) passes
 *   vacuously — it proves nothing but shows green, the worst kind of false
 *   confidence. The fleet survey found a placeholder `expect(true).toBe(true)`
 *   shape used to satisfy "needs an assertion"; this rule is the reason to
 *   delete such placeholders rather than add them. Recognized assertions:
 *   `expect(...)`, `expect.<x>(...)` (e.g. `expect.assertions`), `assert(...)`,
 *   and `vi.*`-spy assertions are NOT counted (a spy call alone isn't an
 *   assertion — it must reach an `expect`). A test that only calls another
 *   function which asserts internally can't be seen statically; for those, add
 *   an inline `expect` or an `// eslint-disable-next-line`. Scope: `*.test.*`.
 *   Report-only. Ported from `@vitest/eslint-plugin`'s `expect-expect`, on
 *   lib/vitest-fn-call.mts.
 */

import {
  classifyVitestCall,
  collectVitestNames,
} from '../lib/vitest-fn-call.mts'

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const TEST_FILE_RE = /\.test\.(?:[mc]?[jt]s)$/

// Root identifiers that count as an assertion when called.
const ASSERTION_ROOTS: ReadonlySet<string> = new Set(['assert', 'expect'])

// Walk a subtree; return true as soon as an assertion call is found.
function containsAssertion(node: AstNode): boolean {
  if (!node || typeof node !== 'object') {
    return false
  }
  if (Array.isArray(node)) {
    for (let i = 0, { length } = node; i < length; i += 1) {
      if (containsAssertion(node[i] as AstNode)) {
        return true
      }
    }
    return false
  }
  if (typeof node.type !== 'string') {
    return false
  }
  if (node.type === 'CallExpression') {
    // Root the callee chain to an identifier and check it's an assertion.
    let cur: AstNode | undefined = node.callee
    while (cur) {
      if (cur.type === 'Identifier') {
        if (ASSERTION_ROOTS.has(cur.name)) {
          return true
        }
        break
      }
      if (cur.type === 'MemberExpression') {
        cur = cur.object
        continue
      }
      if (cur.type === 'CallExpression') {
        cur = cur.callee
        continue
      }
      break
    }
  }
  // Don't descend into nested test/describe callbacks — their assertions
  // belong to THOSE cases, not this one. (Handled by the caller scoping to the
  // direct body; here we just recurse structurally but stop at nested calls
  // that are themselves test cases would require names — kept simple: recurse
  // all; a nested it() with expect is rare inside an it() and still means the
  // outer has an assertion-bearing subtree, which is acceptable.)
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') {
      continue
    }
    const child = (node as Record<string, unknown>)[key]
    if (child && typeof child === 'object') {
      if (containsAssertion(child as AstNode)) {
        return true
      }
    }
  }
  return false
}

// The callback function argument of a test call, or undefined.
function testCallback(node: AstNode): AstNode | undefined {
  if (!Array.isArray(node.arguments)) {
    return undefined
  }
  for (let i = 0, { length } = node.arguments; i < length; i += 1) {
    const arg = node.arguments[i] as AstNode
    if (
      arg?.type === 'ArrowFunctionExpression' ||
      arg?.type === 'FunctionExpression'
    ) {
      return arg
    }
  }
  return undefined
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a test case with no assertion — a test with no expect(...) passes vacuously.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      noAssertion:
        'Test `{{ title }}` has no assertion — it passes vacuously and proves nothing. Add an `expect(...)`, or delete the test if it was a placeholder.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!TEST_FILE_RE.test(filename)) {
      return {}
    }
    let names: Map<string, string> | undefined
    let fromVitestImport: Set<string> | undefined
    // Stand down entirely on files that import from node:test — those `it`
    // tests assert via `throw`, not `expect`, so "no expect" is not a defect.
    let disabled = false
    return {
      Program(program: AstNode) {
        const collected = collectVitestNames(program)
        names = collected.names
        fromVitestImport = collected.fromVitestImport
        disabled = collected.importsNodeTest
      },
      CallExpression(node: AstNode) {
        if (!names || disabled) {
          return
        }
        const call = classifyVitestCall(node, names)
        if (!call || call.kind !== 'test') {
          return
        }
        // Only flag tests whose `it`/`test` binding was actually imported from
        // 'vitest' — a globals-fallback match could be another runner's `it`
        // that legitimately asserts without `expect`.
        if (!fromVitestImport?.has(call.localChain[0]!)) {
          return
        }
        // `.todo` / `.skip` cases legitimately have no body assertion.
        if (call.modifiers.includes('todo') || call.modifiers.includes('skip')) {
          return
        }
        const cb = testCallback(node)
        if (!cb?.body) {
          return
        }
        if (!containsAssertion(cb.body)) {
          const titleArg = node.arguments?.[0] as AstNode | undefined
          const title =
            titleArg?.type === 'Literal' ? String(titleArg.value) : '<dynamic>'
          context.report({
            node,
            messageId: 'noAssertion',
            data: { title },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
