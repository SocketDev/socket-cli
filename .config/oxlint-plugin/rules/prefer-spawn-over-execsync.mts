/**
 * @file Per the fleet "Subprocesses" rule: prefer `spawn` from
 *   `@socketsecurity/lib-stable/spawn/spawn` over `execSync` / `execFileSync`
 *   from `node:child_process`. Two reasons:
 *
 *   1. Command-injection surface — `execSync(cmd)` runs `cmd` through a shell; any
 *      string concatenation into `cmd` is a potential injection vector.
 *      `execFileSync(file, args)` is safer (no shell) but still picks up `PATH`
 *      lookups and offers no structured error shape.
 *   2. Consistency — the fleet `spawn` wrapper ships a typed `SpawnError` shape,
 *      an `isSpawnError` guard, and accepts an array-of-args contract that
 *      mirrors `spawnSync` from `node:child_process`. Every fleet repo uses it;
 *      mixing `execSync`/`execFileSync` for one-offs forces readers to remember
 *      two error shapes. Detects:
 *
 *   - `import { execSync, execFileSync } from 'node:child_process'`
 *   - `import { execSync, execFileSync } from 'child_process'`
 *   - `child_process.execSync(...)` / `child_process.execFileSync(...)` No
 *     autofix. The API shapes differ enough that a mechanical rewrite would
 *     silently break callers reading `.status`, `.stdout`, `.stderr` from the
 *     sync result. Human eyes pick the right migration: `await spawn(...)` (the
 *     common case) or `spawnSync(...)` from the lib (if the caller's flow is
 *     genuinely top-level-sync). Allowed exceptions:
 *   - Adjacent comment with `prefer-spawn-over-execsync: required` — for callers
 *     who genuinely need shell expansion (e.g. expanding env vars mid-command).
 *     Rare; document why.
 *   - Files inside `@socketsecurity/lib-stable/spawn/spawn` itself — handled at
 *     the .config/oxlintrc.json ignorePatterns level.
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const CHILD_PROCESS_SPECIFIERS = new Set([
  'child_process',
  'node:child_process',
])

const BANNED_NAMES = new Set(['execFileSync', 'execSync'])

const BYPASS_RE = /prefer-spawn-over-execsync:\s*required/

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use `spawn` from @socketsecurity/lib-stable/spawn/spawn instead of `execSync` / `execFileSync` from node:child_process.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      importBanned:
        'Importing `{{name}}` from {{specifier}} — use `spawn` (or `spawnSync` for top-level-sync) from @socketsecurity/lib-stable/spawn/spawn. `execSync` runs through a shell (command-injection surface); array-arg `spawn` does not. The lib also ships a typed SpawnError shape — `execSync` errors are plain Errors with no structured fields.',
      callBanned:
        'Calling `{{obj}}.{{name}}(...)` — use `spawn` from @socketsecurity/lib-stable/spawn/spawn instead. Avoids shell-interpolation injection paths; ships consistent SpawnError shape.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function hasBypassComment(node: AstNode): boolean {
      const before = sourceCode.getCommentsBefore(node)
      const after = sourceCode.getCommentsAfter(node)
      for (let i = 0, { length } = before; i < length; i += 1) {
        if (BYPASS_RE.test(before[i]!.value)) {
          return true
        }
      }
      for (let i = 0, { length } = after; i < length; i += 1) {
        if (BYPASS_RE.test(after[i]!.value)) {
          return true
        }
      }
      return false
    }

    return {
      ImportDeclaration(node: AstNode) {
        const specifier = node.source.value
        if (!CHILD_PROCESS_SPECIFIERS.has(specifier)) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        const banned = node.specifiers.filter(
          (s: AstNode) =>
            s.type === 'ImportSpecifier' &&
            s.imported &&
            BANNED_NAMES.has(s.imported.name),
        )
        if (banned.length === 0) {
          return
        }
        for (let i = 0, { length } = banned; i < length; i += 1) {
          const spec = banned[i]!
          context.report({
            node: spec,
            messageId: 'importBanned',
            data: {
              name: spec.imported.name,
              specifier: `'${specifier}'`,
            },
          })
        }
      },

      // child_process.execSync(...) / cp.execFileSync(...) — covers the
      // `require('child_process').execSync(...)` path too.
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression') {
          return
        }
        if (callee.property.type !== 'Identifier') {
          return
        }
        if (!BANNED_NAMES.has(callee.property.name)) {
          return
        }
        const obj = callee.object
        const objName =
          obj.type === 'Identifier'
            ? obj.name
            : obj.type === 'MemberExpression' &&
                obj.property.type === 'Identifier'
              ? obj.property.name
              : undefined
        if (!objName) {
          return
        }
        if (!/^(childProcess|child_process|cp)$/.test(objName)) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        context.report({
          node,
          messageId: 'callBanned',
          data: { obj: objName, name: callee.property.name },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
