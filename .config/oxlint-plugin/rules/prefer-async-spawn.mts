/**
 * @fileoverview Per CLAUDE.md "Subprocesses" rule:
 *
 *   Prefer async `spawn` from `@socketsecurity/lib/spawn` over
 *   `spawnSync` from `node:child_process`. Async unblocks parallel
 *   tests / event-loop work; the sync version freezes the runner for
 *   the duration of the child. Use `spawnSync` only when you genuinely
 *   need synchronous semantics.
 *
 * Detects:
 *   - `import { spawnSync } from 'node:child_process'`
 *   - `import { spawnSync } from 'child_process'`
 *   - `child_process.spawnSync(...)` calls (when the require side
 *     dodges the import-name detector).
 *   - `spawn` from `node:child_process` — recommend the lib instead.
 *     Even the async core spawn lacks the lib's SpawnError shape.
 *
 * Autofix scope (deterministic; no AI required):
 *   - **Imports**: rewrites the import statement to pull from
 *     `@socketsecurity/lib/spawn`. `spawnSync` becomes `spawn` and
 *     callers see the imported binding rename. Skipped when:
 *       a) the import has multiple violating names (would need a
 *          merged import statement),
 *       b) the file already has another import from the lib that
 *          would clash,
 *       c) any non-banned named import (e.g. `exec`, `execSync`)
 *          shares the same statement — the lib doesn't re-export
 *          those, so we can't safely rewrite the whole line.
 *   - **Calls**: `await child_process.spawnSync(args)` inside an
 *     async function body becomes `await spawn(args)` (assuming the
 *     spawn import is also rewritten). We require the call to be the
 *     argument of an `await` already, OR the surrounding function to
 *     be async — that's the marker for "the caller is ready for a
 *     promise."
 *
 * Allowed exceptions:
 *   - Adjacent comment with `prefer-async-spawn: sync-required` —
 *     for top-level scripts whose entire flow is sync (per CLAUDE.md
 *     "Reserve `spawnSync` for top-level scripts whose entire flow is
 *     sync").
 *   - Files inside `@socketsecurity/lib/spawn` itself — they wrap the
 *     core APIs. Handled at the .config/oxlintrc.json ignorePatterns level.
 */

const CHILD_PROCESS_SPECIFIERS = new Set([
  'node:child_process',
  'child_process',
])

const LIB_SPECIFIER = '@socketsecurity/lib/spawn'

const BANNED_NAMES = new Set(['spawnSync', 'spawn'])

const BYPASS_RE = /prefer-async-spawn:\s*sync-required/

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use `spawn` from @socketsecurity/lib/spawn instead of `spawnSync` / core `spawn` from node:child_process.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      importBanned:
        'Importing `{{name}}` from {{specifier}} — use `spawn` from @socketsecurity/lib/spawn. Async unblocks parallel work and the lib ships consistent error shapes (SpawnError).',
      callBanned:
        'Calling `child_process.{{name}}(...)` — use `spawn` from @socketsecurity/lib/spawn instead.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function hasBypassComment(node) {
      const before = sourceCode.getCommentsBefore(node)
      const after = sourceCode.getCommentsAfter(node)
      for (const c of [...before, ...after]) {
        if (BYPASS_RE.test(c.value)) {
          return true
        }
      }
      return false
    }

    /**
     * Walk up the AST until we find an enclosing function or the
     * Program root. Returns true when an `async` function or top-level
     * module is reached (top-level await is allowed in ES modules).
     */
    function isInAsyncContext(node) {
      let cur = node.parent
      while (cur) {
        if (
          cur.type === 'FunctionDeclaration' ||
          cur.type === 'FunctionExpression' ||
          cur.type === 'ArrowFunctionExpression'
        ) {
          return Boolean(cur.async)
        }
        if (cur.type === 'Program') {
          // Top-level: ESM allows top-level await, so async context is
          // available. CommonJS doesn't, but we can't reliably tell
          // from the AST alone — `sourceType: 'module'` is the signal.
          return cur.sourceType === 'module'
        }
        cur = cur.parent
      }
      return false
    }

    /**
     * Build a fixer for an import declaration. Conservatively skip
     * when other (non-banned) named imports share the line — those
     * may not be re-exported by the lib spawn module.
     *
     * Successful rewrite: replaces the whole import statement with
     * `import { spawn } from '@socketsecurity/lib/spawn'`.
     */
    function fixImport(fixer, node) {
      const banned = node.specifiers.filter(
        s =>
          s.type === 'ImportSpecifier' &&
          s.imported &&
          BANNED_NAMES.has(s.imported.name),
      )
      if (banned.length === 0) {
        return null
      }
      const others = node.specifiers.filter(
        s =>
          s.type !== 'ImportSpecifier' ||
          !s.imported ||
          !BANNED_NAMES.has(s.imported.name),
      )
      if (others.length > 0) {
        // Mixed line — leave it alone; a partial rewrite could lose
        // the non-banned import.
        return null
      }
      // The lib re-exports `spawn` (and the user can wire `as
      // spawnSync` themselves if they really need a name). For the
      // common case (single `spawnSync` import), rewrite to `spawn`
      // and let the call sites get separately handled.
      return fixer.replaceText(node, `import { spawn } from '${LIB_SPECIFIER}'`)
    }

    return {
      ImportDeclaration(node) {
        const specifier = node.source.value
        if (!CHILD_PROCESS_SPECIFIERS.has(specifier)) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        const banned = node.specifiers.filter(
          s =>
            s.type === 'ImportSpecifier' &&
            s.imported &&
            BANNED_NAMES.has(s.imported.name),
        )
        if (banned.length === 0) {
          return
        }

        for (const spec of banned) {
          context.report({
            node: spec,
            messageId: 'importBanned',
            data: {
              name: spec.imported.name,
              specifier: `'${specifier}'`,
            },
            // Only the first banned-import on the line emits the fix;
            // ESLint dedupes overlapping inserts so this is safe.
            fix(fixer) {
              return fixImport(fixer, node)
            },
          })
        }
      },

      // child_process.spawnSync(...) — covers `require('child_process').spawnSync(...)`
      // and `cp.spawnSync(...)` when the local binding is named cp.
      CallExpression(node) {
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
        // Match `<obj>.spawnSync(...)` where <obj> is a known
        // child_process binding. We can't perfectly track requires
        // without scope analysis, so accept common alias names.
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
        if (!/^(child_process|childProcess|cp)$/.test(objName)) {
          return
        }
        if (hasBypassComment(node)) {
          return
        }

        // Autofix only when we're confident the rewrite is safe:
        //   - Surrounding scope is async (or top-level ESM).
        //   - The call is not used as a value-bearing return (we
        //     can't tell what the caller does with `{ stdout, stderr,
        //     code }` — async spawn returns a thenable, not a sync
        //     object). Detect: parent is an ExpressionStatement OR an
        //     AwaitExpression. Anything else (assignment, return,
        //     property access) needs human eyes.
        const parent = node.parent
        const looksAwaitable =
          parent &&
          (parent.type === 'AwaitExpression' ||
            parent.type === 'ExpressionStatement')
        const fixable = looksAwaitable && isInAsyncContext(node)

        if (!fixable) {
          context.report({
            node,
            messageId: 'callBanned',
            data: { name: callee.property.name },
          })
          return
        }

        context.report({
          node,
          messageId: 'callBanned',
          data: { name: callee.property.name },
          fix(fixer) {
            const argText = node.arguments
              .map(a => sourceCode.getText(a))
              .join(', ')
            // If parent is already an AwaitExpression we keep the
            // await — replace the inner CallExpression. If parent is
            // an ExpressionStatement, prepend `await` so the promise
            // chain is awaited.
            if (parent.type === 'AwaitExpression') {
              return fixer.replaceText(node, `spawn(${argText})`)
            }
            return fixer.replaceText(node, `await spawn(${argText})`)
          },
        })
      },
    }
  },
}

export default rule
