/**
 * @file Forbid hard-coded `path.join(__dirname, '..', '..'[, '..'])` and
 *   `path.resolve(__dirname, '..', '..'[, '..'])` ascent shapes — especially
 *   common in `scripts/` and `.claude/hooks/` modules looking for the repo
 *   root. The ascent count is fragile: every refactor that moves the file
 *   deeper or shallower silently breaks the path resolution. The 73c691d9
 *   scripts-into-fleet/ refactor + the 86c2e575 check-*-into-check/ refactor
 *   combined to break 12 files across two waves before this lint rule landed.
 *   Two satisfying fixes, both depth-independent: import the repo's single
 *   `REPO_ROOT` (the constructed value in `scripts/fleet/paths.mts`, which
 *   walks to the nearest `package.json` via `resolveRepoRoot()`), or
 *   `findRepoRoot(import.meta)` from
 *   `@socketsecurity/lib-stable/paths/repo-root` once the lib export lands
 *   fleet-wide. Either way the ascent count is computed at runtime, so a file
 *   moving directory depth doesn't break it. Scope: only flags chains of TWO OR
 *   MORE `'..'` segments inside a `path.join`/`path.resolve` call whose FIRST
 *   argument is the identifier `__dirname`. A single `'..'` is allowed because
 *   most one-level walks are intentional and stable (e.g. `path.join(
 *   __dirname, '..', 'fixtures')` reaches a sibling of the calling script, not
 *   the repo root). No autofix — the right substitute may need extra path
 *   segments appended (`path.join(findRepoRoot(import.meta), 'docs',
 *   'foo.md')`) and the file may need a new import. Manual fix per call site.
 *   Activation: `error`. The `REPO_ROOT`-from-`paths.mts` fix is available in
 *   every fleet repo today (it predates the lib helper), so the rule can gate
 *   at full strength without waiting on the `findRepoRoot` export to propagate
 *   through the `lib-stable` cascade.
 */

import type { AstNode, RuleContext } from '../lib/rule-types.mts'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer importing REPO_ROOT from paths.mts (or findRepoRoot(import.meta)) over `path.join(__dirname, "..", "..")`. The ascent count drifts on every scripts-into-subdir refactor.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: undefined,
    messages: {
      preferFindRepoRoot:
        '`{{call}}(__dirname, {{ascent}})` is fragile — the {{count}}× `..` chain breaks every time this file moves between directories. Import `REPO_ROOT` from `paths.mts` (or `findRepoRoot(import.meta)` once it ships in lib-stable), which walks up to the nearest `package.json` and stays correct across refactors.',
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
          messageId: 'preferFindRepoRoot',
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
