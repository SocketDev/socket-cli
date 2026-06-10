/**
 * @file Forbid `process.chdir()` anywhere outside test files. Where the
 *   companion `no-process-cwd-in-scripts-hooks` rule bans _reading_ an unstable
 *   cwd in scripts/hooks, this bans _mutating_ it — and that mutation is
 *   dangerous everywhere, not just in scripts:
 *
 *   - cwd is global process state. A `chdir` in one module silently changes what
 *     every other module's relative-path resolution + `process.cwd()` returns,
 *     including code running concurrently (a parallel task, a pending promise,
 *     an event handler that fires after the chdir).
 *   - It breaks the fleet's parallel-session model: two operations in one process
 *     can't each assume their own cwd once one of them chdir'd.
 *   - It is rarely reversible cleanly — the "chdir, do work, chdir back" pattern
 *     leaks the original cwd on any throw between the two calls. The fix is
 *     always to pass an explicit `{ cwd }` to the API that needs it (spawn, fs,
 *     glob, etc.) rather than relocating the whole process. The fleet `spawn` /
 *     `spawnSync` and lib fs helpers all take a `cwd` option. Scope: every file
 *     EXCEPT tests (`**∕test/**` or `**∕*.test.*`), which chdir intentionally
 *     to exercise cwd-sensitive code. No autofix — the right substitute is an
 *     explicit `cwd` option whose value depends on the call site.
 */

/**
 * @type {import('eslint').Rule.RuleModule}
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid `process.chdir()` — cwd is global process state; pass an explicit `{ cwd }` to the API that needs it instead.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      processChdir:
        '`process.chdir()` mutates global cwd and breaks every other module + concurrent task in the process. Pass an explicit `{ cwd }` to the API that needs it (spawn, fs, glob) instead of relocating the whole process.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    // Test files are exempt — tests chdir intentionally to exercise
    // cwd-sensitive code paths.
    if (/\/test\//.test(filename) || /\.test\.(?:[mc]?[jt]s)$/.test(filename)) {
      return {}
    }

    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.object.type !== 'Identifier' ||
          callee.object.name !== 'process' ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'chdir'
        ) {
          return
        }
        context.report({
          node,
          messageId: 'processChdir',
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
