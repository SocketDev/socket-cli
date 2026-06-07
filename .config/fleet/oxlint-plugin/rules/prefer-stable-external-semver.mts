/**
 * @file Per CLAUDE.md "Tooling — bundled deps stay devDeps; runtime tools use
 *   the lib-stable wrapper." Bare `semver` imports trip the fleet's
 *   bundled-deps rule: every consumer would carry `semver` as a runtime dep
 *   instead of via the canonical `@socketsecurity/lib-stable/external/semver`
 *   wrapper. Reports + autofixes any `import ... from 'semver'` (or sub-path
 *   like `'semver/functions/satisfies'`) to
 *   `@socketsecurity/lib-stable/external/semver`. Skips:
 *
 *   - Files under `src/external/` (the wrapper itself plus type-only forwarders
 *     that legitimately import the upstream package types).
 *   - Type-only imports (`import type ... from 'semver'`) — the bundle-deps
 *     concern is runtime; types don't affect emitted output.
 *   - Files under `**∕test/fixtures/**` (literal test strings that happen to
 *     parse as imports). The autofix rewrites the specifier string only;
 *     bindings stay intact.
 */

import { makeBypassChecker } from '../lib/comment-markers.mts'
import type { AstNode, RuleContext, RuleFixer } from '../lib/rule-types.mts'

// socket-lint: allow bare-semver -- opt-out for `semver` consumers inside the
// `src/external/` wrapper itself or anywhere the bundle-deps concern doesn't
// apply (e.g. a bundler config that needs the upstream package directly).
const BYPASS_RE = /socket-lint:\s*allow\s+bare-semver/

const STABLE_PATH = '@socketsecurity/lib-stable/external/semver'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Use '@socketsecurity/lib-stable/external/semver' instead of the bare 'semver' import.",
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        "Bare 'semver' import — use '@socketsecurity/lib-stable/external/semver' (or '@socketsecurity/lib/external/semver' inside socket-lib's own src). The wrapper keeps the upstream bundled-dep status, so consumers don't carry a runtime semver dependency.",
    },
    schema: [],
    fixable: 'code',
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)
    const filename = context.getFilename?.() ?? context.physicalFilename ?? ''
    // Wrapper + type-forwarder files legitimately import the upstream
    // package. Skip everything under src/external/ to avoid recursion.
    if (filename.includes('/src/external/')) {
      return {}
    }
    return {
      ImportDeclaration(node: AstNode) {
        const source = node.source
        if (source?.type !== 'Literal' || typeof source.value !== 'string') {
          return
        }
        const spec = source.value
        // Match `semver` or `semver/<subpath>` exactly. Reject anything
        // that has `semver` only as a substring (e.g. `my-semver`).
        if (spec !== 'semver' && !spec.startsWith('semver/')) {
          return
        }
        // Type-only `import type X from 'semver'` doesn't ship runtime
        // code; the bundle-deps concern doesn't apply.
        if (node.importKind === 'type') {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        const replacement =
          spec === 'semver' ? STABLE_PATH : `${STABLE_PATH}/${spec.slice(7)}`
        context.report({
          node: source,
          messageId: 'banned',
          fix(fixer: RuleFixer) {
            const q = source.raw?.[0] === '"' ? '"' : "'"
            return fixer.replaceText(source, `${q}${replacement}${q}`)
          },
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
