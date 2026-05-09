/**
 * @fileoverview Per CLAUDE.md "Promise.race / Promise.any in loops"
 * rule + the `plug-leaking-promise-race` skill: never re-race a pool
 * that survives across iterations. Each call's handlers stack onto
 * the surviving promises, leaking memory and deferring rejection
 * propagation.
 *
 * Detects:
 *   - `Promise.race(...)` / `Promise.any(...)` syntactically inside
 *     a `for`, `for-of`, `for-in`, `while`, or `do-while` body.
 *
 * The semantic check (whether the racer is the SAME pool across
 * iterations) is undecidable from syntax. We flag every race-in-loop
 * and let the human confirm it's safe (e.g., a freshly-built array
 * each iteration). The skill at .claude/skills/plug-leaking-promise-race/
 * documents the safe shapes.
 *
 * No autofix: the right fix is design-level (track the pool outside
 * the loop, use AbortController, or restructure to a single race).
 * Reporting only.
 */

const RACE_METHODS = new Set(['any', 'race'])

const LOOP_TYPES = new Set(['DoWhileStatement', 'ForInStatement', 'ForOfStatement', 'ForStatement', 'WhileStatement'])

function isInsideLoop(node) {
  let current = node.parent
  while (current) {
    if (LOOP_TYPES.has(current.type)) {
      return true
    }
    // Function boundaries break the chain — a function defined inside
    // a loop and invoked elsewhere isn't "in" the loop.
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      return false
    }
    current = current.parent
  }
  return false
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban Promise.race / Promise.any inside loop bodies — handlers stack on surviving promises and leak.',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        'Promise.{{method}}() inside a loop — handlers stack on surviving promises across iterations and leak. See .claude/skills/plug-leaking-promise-race/SKILL.md for safe shapes.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression') {
          return
        }
        if (
          callee.object.type !== 'Identifier' ||
          callee.object.name !== 'Promise'
        ) {
          return
        }
        if (callee.property.type !== 'Identifier') {
          return
        }
        if (!RACE_METHODS.has(callee.property.name)) {
          return
        }
        if (!isInsideLoop(node)) {
          return
        }

        context.report({
          node,
          messageId: 'banned',
          data: { method: callee.property.name },
        })
      },
    }
  },
}

export default rule
