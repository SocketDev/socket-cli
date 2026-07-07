/*
 * @file Flag UNCONDITIONALLY skipped vitest tests — `it.skip` / `test.skip` /
 *   `describe.skip` and the `xit` / `xtest` / `xdescribe` aliases — left in
 *   committed code. A bare `.skip` is a test that never runs again and rots
 *   silently. ADAPTED from `@vitest/eslint-plugin`'s `no-disabled-tests`: the
 *   fleet legitimately uses CONDITIONAL skips, so those are ALLOWED:
 *
 *   - `it.skipIf(cond)(...)` / `it.runIf(cond)(...)` — runtime-gated, fine.
 *   - `describe(name, { skip: <expr> }, fn)` — options-object skip with any
 *     expression, fine (the fleet's coverage-mode pattern: `describe(eco, {
 *     skip: !pkgs.length }, …)`). Only an unconditional `.skip` / `x*` alias
 *     with no gating condition is reported. Scope: `*.test.*`. Report-only —
 *     un-skip vs. delete is the author's call. Built on
 *     lib/vitest-fn-call.mts.
 */

import { TEST_FILE_RE } from '../../lib/test-file.mts'
import {
  classifyVitestCall,
  collectVitestNames,
} from '../../lib/vitest-fn-call.mts'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// `xit` / `xtest` / `xdescribe` are unconditional-skip aliases.
const SKIP_ALIASES: ReadonlySet<string> = new Set(['xdescribe', 'xit', 'xtest'])

// Does any argument carry an options object with a `skip` property? That's the
// fleet's conditional-skip form (`{ skip: <expr> }`) — allowed.
function hasOptionsSkip(node: AstNode): boolean {
  if (!Array.isArray(node.arguments)) {
    return false
  }
  for (let i = 0, { length } = node.arguments; i < length; i += 1) {
    const arg = node.arguments[i] as AstNode
    if (arg?.type !== 'ObjectExpression' || !Array.isArray(arg.properties)) {
      continue
    }
    for (let j = 0, { length: plen } = arg.properties; j < plen; j += 1) {
      const prop = arg.properties[j] as AstNode
      if (
        prop?.type === 'Property' &&
        !prop.computed &&
        prop.key?.type === 'Identifier' &&
        prop.key.name === 'skip'
      ) {
        return true
      }
    }
  }
  return false
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow unconditionally skipped vitest tests (it.skip / xit / xdescribe) — conditional skips (.skipIf/.runIf, { skip: expr }) are allowed.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      skipped:
        'Unconditionally skipped test `{{ chain }}` never runs again. Gate it on a condition (`.skipIf(...)` / `{ skip: <expr> }`) or remove it — a bare `.skip` rots silently.',
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
        // Conditional skip via modifier (`.skipIf` / `.runIf`) is fine.
        if (
          call.modifiers.includes('skipIf') ||
          call.modifiers.includes('runIf')
        ) {
          return
        }
        // Conditional skip via options object (`{ skip: <expr> }`) is fine.
        if (hasOptionsSkip(node)) {
          return
        }
        const skipped =
          call.modifiers.includes('skip') || SKIP_ALIASES.has(call.root)
        if (skipped) {
          context.report({
            node,
            messageId: 'skipped',
            data: { chain: call.localChain.join('.') },
          })
        }
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
