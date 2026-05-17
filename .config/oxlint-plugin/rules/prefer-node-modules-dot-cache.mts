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
 * Exempts:
 *   - `path.join(home, '.cache', ...)` where the first arg is an
 *     identifier that obviously names a user-home dir (`home`,
 *     `homedir`, `userHome`, etc.) or is a call to `os.homedir()`
 *     or `os.userInfo().homedir`, or reads an HOME-style env var
 *     (`HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA`, `APPDATA`). These
 *     are XDG-spec platform-dir helpers, NOT repo-root cache paths.
 *
 * Autofix: none (the rewrite needs context — sometimes you want
 * `node_modules/.cache/foo`, sometimes `node_modules/.cache/<pkg>/foo`,
 * sometimes a temp dir is appropriate). Report-only; manual fix.
 *
 * Scope: .ts / .cts / .mts / .js / .cjs / .mjs.
 */

import { normalizePath } from '@socketsecurity/lib/paths/normalize'

// Match `.cache` only as a path segment inside a larger path, never as
// a bare standalone string. A bare `.cache` is conventionally a
// `path.join` arg — those are handled by the call-shape visitor, which
// can apply the user-home-dir exemption. Detecting bare `.cache` here
// double-flags every `path.join(home, '.cache', app)` from XDG helpers.
//
// Inputs are normalized through @socketsecurity/lib's `normalizePath`
// before this regex runs, so we only have to match the `/` form.

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const REPO_CACHE_STRING_RE = /(?:^|\/)\.cache\/|\/\.cache$/

// Identifier names whose value is conventionally a user-home dir.
// Matched case-insensitively so `home`, `Home`, `homeDir`, `HOME` etc.
// all hit.
const HOME_IDENT_RE = /^(?:home(?:dir)?|userhome|userdir|app(?:data|home))$/i

// Env-var names that hold user-home dirs (the XDG/Windows variants).
// Used when the first arg is `process.env['VAR']` or `process.env.VAR`.
const HOME_ENV_RE =
  /^(?:HOME|XDG_(?:CACHE|CONFIG|DATA|STATE)_HOME|XDG_RUNTIME_DIR|LOCALAPPDATA|APPDATA|USERPROFILE)$/

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

  create(context: RuleContext) {
    /**
     * Is the leading segment of `value` already `node_modules`? Catches
     * `node_modules/.cache/foo` (allowed) without false-positive on
     * `.cache/foo` (forbidden). Input is expected to be already
     * normalized (forward slashes).
     */
    function isNodeModulesCache(value: string): boolean {
      return /(^|\/)node_modules\/\.cache(\/|$)/.test(value)
    }

    /**
     * True for a Literal node whose string value matches the
     * repo-root `.cache` pattern and is NOT already a
     * `node_modules/.cache` path.
     */
    function isRepoRootCacheString(node: AstNode) {
      if (node.type !== 'Literal' && node.type !== 'TemplateElement') {
        return false
      }
      const raw =
        node.type === 'TemplateElement'
          ? (node.value?.cooked ?? '')
          : (typeof node.value === 'string' ? node.value : '')
      if (!raw) return false
      // Normalize backslashes → forward slashes, collapse `.` / `..` segments,
      // preserve UNC/namespace prefixes. Lets us use a single-separator
      // regex below instead of `[/\\]` duplicated everywhere.
      const norm = normalizePath(raw)
      if (!REPO_CACHE_STRING_RE.test(norm)) return false
      if (isNodeModulesCache(norm)) return false
      return true
    }

    /**
     * True when `node` is, by name or shape, an expression that yields
     * the current user's home dir. Used to exempt XDG / platform-dir
     * helpers (where `~/.cache/<app>` is the correct convention, not
     * a fleet violation).
     *
     * Matches:
     *   - Identifier whose name fits HOME_IDENT_RE (`home`, `homedir`, etc.)
     *   - `os.homedir()` call (or `nodeOs.homedir()`, any `<id>.homedir()`)
     *   - `process.env.HOME` / `process.env['HOME']` / same for XDG vars
     */
    function isHomeDirExpression(node: AstNode) {
      if (!node) return false
      // `home` / `homedir` / `userHome` / `appData` identifier.
      if (node.type === 'Identifier' && HOME_IDENT_RE.test(node.name)) {
        return true
      }
      // `os.homedir()` and friends.
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.property.type === 'Identifier' &&
        node.callee.property.name === 'homedir'
      ) {
        return true
      }
      // `process.env.HOME` / `process.env['HOME']`.
      if (node.type === 'MemberExpression') {
        const obj = node.object
        const prop = node.property
        const isProcessEnv =
          obj.type === 'MemberExpression' &&
          obj.object.type === 'Identifier' &&
          obj.object.name === 'process' &&
          !obj.computed &&
          obj.property.type === 'Identifier' &&
          obj.property.name === 'env'
        if (isProcessEnv) {
          const key =
            !node.computed && prop.type === 'Identifier'
              ? prop.name
              : prop.type === 'Literal' && typeof prop.value === 'string'
                ? prop.value
                : ''
          if (key && HOME_ENV_RE.test(key)) return true
        }
      }
      return false
    }

    /**
     * Detect `path.join(...args)` where `'.cache'` is one of the args
     * and no PRIOR arg is `'node_modules'`. We approximate "prior" by
     * walking left-to-right.
     */
    function checkPathJoin(node: AstNode) {
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
      // Bail when the first arg is a user-home expression: this is an
      // XDG-style platform-dir helper, not a repo-root cache.
      if (args.length > 0 && isHomeDirExpression(args[0])) {
        return
      }
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
    function checkLiteral(node: AstNode) {
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
