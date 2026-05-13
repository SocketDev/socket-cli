/**
 * @fileoverview Fleet convention: per-repo tool caches live in
 * `node_modules/.cache/`, NOT `<repo-root>/.cache/`.
 *
 * Why `node_modules/.cache/`:
 *   - It's the convention every JS build tool already uses (vitest,
 *     babel, terser, webpack, etc.) — discoverable.
 *   - It's gitignored everywhere (pnpm/npm gitignore `node_modules/`).
 *   - `pnpm install` blows it away when needed (no stale-cache
 *     headaches surviving a fresh checkout).
 *   - Centralizes cache location so the fleet's drift sweep can
 *     reason about it.
 *
 * Repo-root `.cache/` works because the fleet's gitignore has
 * a `.cache/` glob, but it's a second canonical location for the
 * same concept — duplication invites drift.
 *
 * Detects:
 *   - String literals `'.cache/...'` / `'./.cache/...'` /
 *     `'/.cache/...'` not preceded by `'node_modules'`.
 *   - `path.join(<args>, '.cache', ...)` where no prior arg is the
 *     literal `'node_modules'`.
 *
 * Autofix: none (the rewrite needs context — sometimes you want
 * `node_modules/.cache/foo`, sometimes `node_modules/.cache/<pkg>/foo`,
 * sometimes a temp dir is appropriate). Report-only; manual fix.
 *
 * Scope: .ts / .cts / .mts / .js / .cjs / .mjs.
 */

const REPO_CACHE_STRING_RE = /(^|[/\\])\.cache(?:[/\\]|$)/

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer `node_modules/.cache/` over repo-root `.cache/` for per-repo tool caches.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      pathLiteral:
        'Cache path `{{value}}` should live under `node_modules/.cache/`, not repo-root `.cache/`. Fleet convention puts per-repo tool caches in `node_modules/.cache/<name>` (auto-gitignored, swept on `pnpm install`).',
      pathJoin:
        '`path.join(..., \'.cache\', ...)` puts the cache at repo root. Use `path.join(<pkgRoot>, \'node_modules\', \'.cache\', <name>)` instead.',
    },
    schema: [],
  },

  create(context) {
    /**
     * Is the leading segment of `value` already `node_modules`? Catches
     * `node_modules/.cache/foo` (allowed) without false-positive on
     * `.cache/foo` (forbidden).
     */
    function isNodeModulesCache(value) {
      // Normalize to forward slashes for the regex.
      const norm = value.replace(/\\/g, '/')
      // Already-canonical paths look like `<...>node_modules/.cache/...`.
      return /(^|\/)node_modules\/\.cache(\/|$)/.test(norm)
    }

    /**
     * True for a Literal node whose string value matches the
     * repo-root `.cache` pattern and is NOT already a
     * `node_modules/.cache` path.
     */
    function isRepoRootCacheString(node) {
      if (node.type !== 'Literal' && node.type !== 'TemplateElement') {
        return false
      }
      const raw =
        node.type === 'TemplateElement'
          ? (node.value?.cooked ?? '')
          : (typeof node.value === 'string' ? node.value : '')
      if (!raw) return false
      if (!REPO_CACHE_STRING_RE.test(raw)) return false
      if (isNodeModulesCache(raw)) return false
      return true
    }

    /**
     * Detect `path.join(...args)` where `'.cache'` is one of the args
     * and no PRIOR arg is `'node_modules'`. We approximate "prior" by
     * walking left-to-right.
     */
    function checkPathJoin(node) {
      if (node.type !== 'CallExpression') return
      const callee = node.callee
      if (
        callee.type !== 'MemberExpression' ||
        callee.computed ||
        callee.property.type !== 'Identifier' ||
        callee.property.name !== 'join'
      ) {
        return
      }
      // Accept `path.join(...)` and `nodePath.join(...)` and `posix.join`
      // — anything named `join` on an identifier. Cheaper than tracking
      // imports; false positives are vanishingly rare (no one names a
      // non-path util `.join`).
      const args = node.arguments
      let sawNodeModules = false
      for (let i = 0; i < args.length; i += 1) {
        const a = args[i]
        if (a.type === 'Literal' && typeof a.value === 'string') {
          if (a.value === 'node_modules') {
            sawNodeModules = true
            continue
          }
          if (a.value === '.cache' && !sawNodeModules) {
            context.report({
              node: a,
              messageId: 'pathJoin',
            })
            return
          }
        }
      }
    }

    /**
     * Visit Literal / TemplateElement nodes and flag repo-root .cache
     * paths.
     */
    function checkLiteral(node) {
      if (!isRepoRootCacheString(node)) return
      const value =
        node.type === 'TemplateElement'
          ? node.value?.cooked
          : node.value
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

export default rule
