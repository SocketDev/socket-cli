/**
 * @file Forbid hard-coded `path.join(__dirname, '..', '..'[, '..'])` and
 *   `path.resolve(__dirname, '..', '..'[, '..'])` ascent shapes — especially
 *   common in `scripts/` and `.claude/hooks/` modules looking for the enclosing
 *   package root. The ascent count is fragile: every refactor that moves the
 *   file deeper or shallower silently breaks the path resolution. The 73c691d9
 *   scripts-into-fleet/ refactor + the 86c2e575 check-_-into-check/ refactor
 *   combined to break 12 files across two waves before this lint rule landed.
 *   Use `findUpPackageJson(import.meta)` — the helper exported by the fleet lib
 *   (`@socketsecurity/lib-stable`) — instead. (The exact package-helpers
 *   subpath has moved across lib releases, so this rule names the function, not
 *   a pinned subpath.) It walks up to the nearest `package.json` from the
 *   script's own location and returns the file path. Wrap with `path.dirname()`
 *   to get the package root directory: // Before (fragile, breaks on every
 *   directory refactor): const rootPath = path.join(**dirname, '..', '..') //
 *   After (refactor-proof, returns file path matching findUp_ family): const
 *   rootPath = path.dirname(findUpPackageJson(import.meta)) The "repo root"
 *   framing is intentionally avoided in the helper name: in a monorepo the
 *   package root and the repo root diverge, and this helper finds the nearest
 *   enclosing package, not the repo. Scope: only flags chains of TWO OR MORE
 *   `'..'` segments inside a `path.join`/`path.resolve` call whose FIRST
 *   argument is the identifier `__dirname`. A single `'..'` is allowed because
 *   most one-level walks are intentional and stable (e.g. `path.join(
 *   __dirname, '..', 'fixtures')` reaches a sibling of the calling script, not
 *   the package root). No autofix — the right substitute may need extra path
 *   segments appended (`path.join(path.dirname(findUpPackageJson(import.meta)),
 *   'docs', 'foo.md')`) and the file may need a new import. Manual fix per call
 *   site. Activation: currently `warn` because `findUpPackageJson` shipped in
 *   `@socketsecurity/lib@6.0.7` which has not yet propagated through the
 *   fleet's `lib-stable` cascade. Once the cascade lands (every fleet repo's
 *   `pnpm-workspace.yaml` catalog pins lib-stable ≥ 6.0.7), promote to `error`
 *   in a follow-up commit.
 */

import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer findUpPackageJson(import.meta) over `path.join(__dirname, "..", "..")`. The ascent count drifts on every scripts-into-subdir refactor.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      preferFindUpPackageJson:
        '`{{call}}(__dirname, {{ascent}})` is fragile — the {{count}}× `..` chain breaks every time this file moves between directories. Use `path.dirname(findUpPackageJson(import.meta))` — the `findUpPackageJson` helper exported by the fleet lib (`@socketsecurity/lib-stable`, package helpers) — which walks up to the nearest `package.json` and stays correct across refactors.',
    },
    schema: [],
  },

  create(context: RuleContext) {
    return {
      CallExpression(node: AstNode) {
        const callee = node.callee
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.object.type !== 'Identifier' ||
          callee.object.name !== 'path' ||
          callee.property.type !== 'Identifier'
        ) {
          return
        }
        const method = callee.property.name
        if (method !== 'join' && method !== 'resolve') {
          return
        }
        const args = node.arguments
        if (!args || args.length < 3) {
          // Need at least __dirname + two segments to trip the rule.
          return
        }
        // First arg must be the identifier `__dirname` literally.
        if (args[0]?.type !== 'Identifier' || args[0].name !== '__dirname') {
          return
        }
        // Count consecutive `'..'` string literals starting at args[1].
        // Stop counting at the first non-`'..'` segment (e.g. `'..', '..',
        // 'fixtures', 'foo.json'` counts 2, which is enough to flag).
        let ascentCount = 0
        for (let i = 1; i < args.length; i += 1) {
          const arg = args[i]
          if (
            arg?.type === 'Literal' &&
            typeof arg.value === 'string' &&
            arg.value === '..'
          ) {
            ascentCount += 1
            continue
          }
          break
        }
        if (ascentCount < 2) {
          return
        }
        const ascentArgs = Array(ascentCount).fill("'..'").join(', ')
        context.report({
          node,
          messageId: 'preferFindUpPackageJson',
          data: {
            call: `path.${method}`,
            ascent: ascentArgs,
            count: String(ascentCount),
          },
        })
      },
    }
  },
}

export default rule
