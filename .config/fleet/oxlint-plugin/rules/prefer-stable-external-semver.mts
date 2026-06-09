/**
 * @file Per CLAUDE.md "Tooling — bundled deps stay devDeps; runtime tools use
 *   the lib-stable wrapper." Bare `semver` imports trip the fleet's
 *   bundled-deps rule: every consumer would carry `semver` as a runtime dep
 *   instead of via the curated `@socketsecurity/lib-stable/versions/*` helpers
 *   (`isValidVersion`, `incrementVersion`, `compare`, `satisfiesVersion`, …),
 *   which wrap the bundled semver internally. The bundled `external/semver` is
 *   intentionally NOT a public export, so this rule points at the `versions/*`
 *   surface instead. Report-only: there is no single namespace re-export to
 *   rewrite to (the public API is named helpers across versions/parse,
 *   versions/modify, versions/compare, versions/range), so the author picks the
 *   right helper. Skips:
 *
 *   - Files under `src/external/` (the wrapper itself plus type-only forwarders
 *     that legitimately import the upstream package types).
 *   - Type-only imports (`import type ... from 'semver'`) — the bundle-deps
 *     concern is runtime; types don't affect emitted output.
 */

import { makeBypassChecker } from '../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../lib/rule-types.mts'

// socket-lint: allow bare-semver -- opt-out for `semver` consumers inside the
// `src/external/` wrapper itself or anywhere the bundle-deps concern doesn't
// apply (e.g. a bundler config that needs the upstream package directly).
const BYPASS_RE = /socket-lint:\s*allow\s+bare-semver/

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Use the '@socketsecurity/lib-stable/versions/*' helpers instead of the bare 'semver' import.",
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        "Bare 'semver' import — use the curated '@socketsecurity/lib-stable/versions/*' helpers (isValidVersion / incrementVersion / compare / satisfiesVersion / parseVersion, …) which wrap the bundled semver so consumers don't carry a runtime semver dependency. The bundled 'external/semver' is internal, not a public export.",
    },
    schema: [],
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
        context.report({
          node: source,
          messageId: 'banned',
        })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
