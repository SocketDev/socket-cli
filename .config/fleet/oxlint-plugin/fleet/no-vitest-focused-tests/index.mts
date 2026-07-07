/**
 * @file Flag focused vitest tests — `it.only` / `test.only` / `describe.only`
 *   (and the `fit` / `fdescribe` aliases). A focused test silently disables
 *   every sibling: CI goes green while running a fraction of the suite, so a
 *   stray `.only` left in from local debugging is a coverage hole that passes
 *   review. The fleet survey (2026-06-03) found ZERO `.only` in ~3,880 test
 *   files — which is exactly when a fail-closed guard pays off: it catches the
 *   first one before it lands. Scope: `*.test.*` files. Report-only — removing
 *   the modifier vs. the test is the author's call. Ported from
 *   `@vitest/eslint-plugin`'s `no-focused-tests`, narrowed to the fleet's
 *   globals-off, import-based test style via lib/vitest-fn-call.mts.
 */

import { TEST_FILE_RE } from '../../lib/test-file.mts'
import {
  classifyVitestCall,
  collectVitestNames,
} from '../../lib/vitest-fn-call.mts'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// `fit` / `fdescribe` are focused aliases that carry no `.only` modifier — the
// focus is baked into the root name.
const FOCUSED_ALIASES: ReadonlySet<string> = new Set(['fdescribe', 'fit'])

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow focused vitest tests (it.only / describe.only / fit / fdescribe) — a stray .only disables the rest of the suite and passes CI.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      focused:
        'Focused test `{{ chain }}` disables every sibling test — CI passes while running a fraction of the suite. Remove the `.only` (or `fit`/`fdescribe`) before committing.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    if (!TEST_FILE_RE.test(filename)) {
      return {}
    }
    let names: Map<string, string> | undefined
    return {
      Program(program: AstNode) {
        names = collectVitestNames(program).names
      },
      CallExpression(node: AstNode) {
        if (!names) {
          return
        }
        const call = classifyVitestCall(node, names)
        if (!call || (call.kind !== 'describe' && call.kind !== 'test')) {
          return
        }
        const focused =
          call.modifiers.includes('only') || FOCUSED_ALIASES.has(call.root)
        if (focused) {
          context.report({
            node,
            messageId: 'focused',
            data: { chain: call.localChain.join('.') },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
