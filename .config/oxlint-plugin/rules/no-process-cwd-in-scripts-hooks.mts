/**
 * @fileoverview Forbid `process.cwd()` in files under `scripts/` or
 * `.claude/hooks/`. Both classes of files are invoked by tools or
 * agents from arbitrary working directories — a hook may be triggered
 * by Claude Code with cwd = the file the user just edited; a script
 * may be invoked from a subdir or a worktree.
 *
 * Use one of:
 *
 *   - `fileURLToPath(import.meta.url)` to anchor on the script's own
 *     location, then walk up to find a stable boundary (repo root,
 *     a `package.json` ancestor, etc.).
 *   - The `REPO_ROOT` / `TEMPLATE_DIR` constants exported by
 *     `scripts/sync-scaffolding/paths.mts` — already resolved via
 *     the import.meta.url walk-up.
 *   - The `$CLAUDE_PROJECT_DIR` env var inside a Claude Code hook
 *     (the harness sets it to the project root that registered the
 *     hook).
 *
 * Why not `process.cwd()`:
 *   - A user might `cd packages/foo && node ../../scripts/bar.mts`
 *     — `process.cwd()` returns `packages/foo`, not the repo root.
 *   - A Claude Code hook may run with cwd = the file just edited
 *     (e.g. `cd .claude/hooks/foo && node ./index.mts` patterns
 *     surface during testing).
 *   - cwd is shared state across the process; a parent script that
 *     `chdir`'d before invoking the child sees its own cwd, not
 *     yours.
 *
 * Scope: paths matching `**∕scripts/**∕*.{ts,cts,mts,js,cjs,mjs}` or
 * `**∕.claude/hooks/**∕*.{ts,cts,mts,js,cjs,mjs}`. Test fixtures
 * (`test/` or `**∕*.test.*`) are exempt — tests routinely chdir
 * intentionally.
 *
 * No autofix — the right substitute depends on the script's needs
 * (import.meta.url vs CLAUDE_PROJECT_DIR vs an explicit arg).
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid `process.cwd()` in scripts/ and .claude/hooks/ — cwd is unstable; use fileURLToPath(import.meta.url) or CLAUDE_PROJECT_DIR.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      processCwd:
        '`process.cwd()` is unstable in scripts/ and .claude/hooks/ — the user (or Claude Code) may invoke this from any directory. Anchor on the script\'s own location: `path.dirname(fileURLToPath(import.meta.url))` + walk-up, or read `$CLAUDE_PROJECT_DIR` inside hooks.',
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? ''
    // Only enforce on scripts/ + .claude/hooks/ paths.
    if (
      !/\/(?:scripts|\.claude\/hooks)\//.test(filename) ||
      // Test files inside those dirs are exempt — tests chdir intentionally.
      /\/test\//.test(filename) ||
      /\.test\.(?:[mc]?[jt]s)$/.test(filename)
    ) {
      return {}
    }

    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.object.type !== 'Identifier' ||
          callee.object.name !== 'process' ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'cwd'
        ) {
          return
        }
        context.report({
          node,
          messageId: 'processCwd',
        })
      },
    }
  },
}

export default rule
