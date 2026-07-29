/*
 * @file Fleet convention: per-repo tool caches and per-repo runtime state live
 *   in a repo-root `.cache/`, NOT `node_modules/.cache/`. Why the repo root:
 *
 *   - The store has to outlive the dependency tree. `rm -rf node_modules`, a
 *     package `clean`, and a `pnpm install --force` all take
 *     `node_modules/.cache` with them — and with it the coverage reports, the
 *     hook bundle cache, and the active-edits ledger that concurrent hook
 *     processes are still writing. One such `clean` died on `ENOTEMPTY:
 *     node_modules/.cache` because a hook was mid-write.
 *   - A repo `clean` scopes to build output. The cache root is not build
 *     output, so nothing in a normal workflow should sweep it.
 *   - It stays gitignored: the fleet gitignore block carries a `**∕.cache/`
 *     glob in every member.
 *   - One canonical location keeps the fleet's drift sweep able to reason
 *     about it; a second home for the same concept invites drift.
 *
 *   Detects:
 *
 *   - String literals containing `node_modules/.cache` as a path segment.
 *   - `path.join(<args>, 'node_modules', '.cache', ...)`.
 *
 *   A user-home cache (`~/.cache/<app>`, `$XDG_CACHE_HOME`) is out of scope —
 *   that is the XDG platform convention and has nothing to do with the
 *   per-repo store. Report-only, no autofix: the rewrite is an import of
 *   `FLEET_CACHE_DIR` / `REPO_CACHE_DIR` from the package's `paths.mts`, which
 *   the rule cannot synthesize. Scope: .ts / .cts / .mts / .js / .cjs / .mjs.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// Matches `node_modules/.cache` as a path prefix, a mid-path segment, or the
// trailing segment. Inputs are normalized through @socketsecurity/lib-stable's
// `normalizePath` first, so only the `/` form has to be matched.
const NODE_MODULES_CACHE_RE = /(?:^|\/)node_modules\/\.cache(?:\/|$)/

/**
 * @type {import('eslint').Rule.RuleModule}
 */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer the repo-root tool-cache store over one nested inside `node_modules`, for per-repo tool caches and runtime state.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      pathLiteral:
        'Cache path `{{value}}` nests the store inside `node_modules`, which a `clean` or a `rm -rf node_modules` destroys while hooks are still writing to it. Put per-repo state in the repo-root store instead — import `FLEET_CACHE_DIR` / `REPO_CACHE_DIR` from the package `paths.mts`, which resolve under `TOOL_CACHE_DIR`.',
      pathJoin:
        "`path.join(..., 'node_modules', '.cache', ...)` puts the store inside the dependency tree, where a `clean` sweeps it. Import `FLEET_CACHE_DIR` / `REPO_CACHE_DIR` from the package `paths.mts` instead.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    /**
     * True for a Literal / TemplateElement whose string value names a path
     * under `node_modules/.cache`.
     */
    function isNodeModulesCacheString(node: AstNode) {
      if (node.type !== 'Literal' && node.type !== 'TemplateElement') {
        return false
      }
      const raw =
        node.type === 'TemplateElement'
          ? (node.value?.cooked ?? '')
          : typeof node.value === 'string'
            ? node.value
            : ''
      if (!raw) {
        return false
      }
      // Normalize backslashes → forward slashes, collapse `.` / `..` segments,
      // preserve UNC/namespace prefixes, so a single-separator regex suffices.
      return NODE_MODULES_CACHE_RE.test(normalizePath(raw))
    }

    /**
     * Detect `path.join(...args)` where a `'node_modules'` arg is directly
     * followed by a `'.cache'` arg — the split-literal form of the same path.
     */
    function checkPathJoin(node: AstNode) {
      if (node.type !== 'CallExpression') {
        return
      }
      const callee = node.callee
      if (
        callee.type !== 'MemberExpression' ||
        callee.computed ||
        callee.property.type !== 'Identifier' ||
        callee.property.name !== 'join'
      ) {
        return
      }
      // Accept `path.join(...)`, `nodePath.join(...)`, `posix.join(...)` —
      // anything named `join` on an identifier. Cheaper than tracking imports;
      // false positives are vanishingly rare (no one names a non-path util
      // `.join`).
      const args = node.arguments
      for (let i = 1; i < args.length; i += 1) {
        const prev = args[i - 1]
        const cur = args[i]
        if (
          prev.type === 'Literal' &&
          prev.value === 'node_modules' &&
          cur.type === 'Literal' &&
          cur.value === '.cache'
        ) {
          context.report({ node: cur, messageId: 'pathJoin' })
          return
        }
      }
    }

    /**
     * Visit Literal / TemplateElement nodes and flag node_modules caches.
     */
    function checkLiteral(node: AstNode) {
      if (!isNodeModulesCacheString(node)) {
        return
      }
      const value =
        node.type === 'TemplateElement' ? node.value?.cooked : node.value
      context.report({
        node,
        messageId: 'pathLiteral',
        data: { value: String(value) },
      })
    }

    return {
      Literal: checkLiteral,
      TemplateElement: checkLiteral,
      CallExpression: checkPathJoin,
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
