/**
 * @fileoverview Per CLAUDE.md "Subprocesses" rule:
 *
 *   Prefer async `spawn` from `@socketsecurity/lib-stable/spawn` over
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
 * Autofix scope (deterministic; no AI required) — sync-aware:
 *   The lib re-exports BOTH `spawn` and `spawnSync`. The autofix only
 *   ever rewrites the import source (`node:child_process` →
 *   `@socketsecurity/lib-stable/spawn`); it never changes the imported name,
 *   never collapses `spawnSync` into `spawn`, and never touches call
 *   sites. Converting sync → async is a semantic change (callers must
 *   `await`, return types change from objects to promises) and that's
 *   a human-eyes job, not an autofix.
 *
 *   Skipped when:
 *     a) any non-spawn named import (e.g. `exec`, `execSync`,
 *        `ChildProcess`) shares the same statement — the lib doesn't
 *        re-export those, so we can't safely rewrite the whole line.
 *
 * Allowed exceptions:
 *   - Adjacent comment with `prefer-async-spawn: sync-required` —
 *     for top-level scripts whose entire flow is sync (per CLAUDE.md
 *     "Reserve `spawnSync` for top-level scripts whose entire flow is
 *     sync").
 *   - Files inside `@socketsecurity/lib-stable/spawn` itself — they wrap the
 *     core APIs. Handled at the .config/oxlintrc.json ignorePatterns level.
 */

import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

const CHILD_PROCESS_SPECIFIERS = new Set([
  'node:child_process',
  'child_process',
])

const LIB_SPECIFIER = '@socketsecurity/lib-stable/spawn'

const BANNED_NAMES = new Set(['spawnSync', 'spawn'])

const BYPASS_RE = /prefer-async-spawn:\s*sync-required/

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use `spawn` from @socketsecurity/lib-stable/spawn instead of `spawnSync` / core `spawn` from node:child_process.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      importBanned:
        'Importing `{{name}}` from {{specifier}} — use `spawn` from @socketsecurity/lib-stable/spawn. Async unblocks parallel work and the lib ships consistent error shapes (SpawnError).',
      callBanned:
        'Calling `child_process.{{name}}(...)` — use `spawn` from @socketsecurity/lib-stable/spawn instead.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    const sourceCode = context.getSourceCode
      ? context.getSourceCode()
      : context.sourceCode

    function hasBypassComment(node: AstNode) {
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
     * Build a fixer that swaps the import SOURCE without changing the
     * imported NAMES. The lib re-exports both `spawn` and `spawnSync`
     * (and a `Spawn`-typed namespace under them), so consumers who
     * imported `spawnSync` keep using `spawnSync` from the lib and
     * their call sites stay correct.
     *
     * The original rule collapsed `spawnSync` → `spawn` and left the
     * call sites untouched, producing files that called `spawnSync(...)`
     * with no `spawnSync` symbol in scope. Sync-aware: never rename.
     *
     * Conservatively skip when other (non-banned) named imports share
     * the line — `exec`, `ChildProcess`, etc. aren't re-exported, so
     * the whole-line rewrite would break those references.
     */
    function fixImport(fixer: RuleFixer, node: AstNode) {
      const others = node.specifiers.filter(
        (s: AstNode) =>
          s.type !== 'ImportSpecifier' ||
          !s.imported ||
          !BANNED_NAMES.has(s.imported.name),
      )
      if (others.length > 0) {
        // Mixed line — leave it alone; a partial rewrite could lose
        // the non-banned import.
        return null
      }
      // Replace only the source-string token. node.source covers the
      // quoted specifier (incl. the quotes); replacing just that keeps
      // every original `{ ... }` binding intact, including `as` clauses
      // and the choice between `spawn` and `spawnSync`.
      return fixer.replaceText(node.source, `'${LIB_SPECIFIER}'`)
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
            fix(fixer: RuleFixer) {
              return fixImport(fixer, node)
            },
          })
        }
      },

      // child_process.spawnSync(...) — covers `require('child_process').spawnSync(...)`
      // and `cp.spawnSync(...)` when the local binding is named cp.
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

        // Report — but NO autofix. Converting `<obj>.spawnSync(...)` to
        // `await spawn(...)` is a semantic change: the return value
        // shape flips from a synchronous `{ status, stdout, stderr }`
        // object to an awaited Promise of a different shape (`.code`,
        // not `.status`). Callers using `r.status` would silently break.
        // Imports get auto-fixed (source rewrite only); call sites
        // need human eyes to decide if sync semantics were load-bearing.
        context.report({
          node,
          messageId: 'callBanned',
          data: { name: callee.property.name },
        })
      },
    }
  },
}

export default rule
