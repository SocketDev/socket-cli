/*
 * @file The fleet's canonical semver access is `@socketsecurity/lib-stable/
 *   versions/*` — a curated version API that keeps `semver` a bundled dep of the
 *   lib instead of a runtime dep in every consumer. Importing the bare `semver`
 *   npm package (or a `semver/<subpath>`) is banned. lib@6.1.0 dropped the old
 *   `external/semver` re-export in favor of this API, so there is no wrapper path
 *   to forward to; the mapping is:
 *
 *   - `valid` → `isValidVersion`, `coerce` → `coerceVersion`, `major`/`minor`/
 *     `patch` → `get{Major,Minor,Patch}Version`, `parse` → `parseVersion`
 *     (from `@socketsecurity/lib-stable/versions/parse`);
 *   - `gt`/`gte`/`lt`/`lte`/`eq`/`neq`/`compare`, and `sort`/`rsort` for
 *     ascending/descending order (from `.../versions/compare`);
 *   - `minVersion`/`maxVersion`/`satisfies`/`filter` (from `.../versions/range`).
 *
 *   No autofix — the function names AND import paths differ (e.g. a descending
 *   `rcompare` comparator becomes `compare(b, a)` or `rsort`), so a specifier
 *   rewrite can't be correct. The message names the mapping; the author rewrites
 *   the call sites. Skips:
 *
 *   - Files under `src/external/` (a wrapper that legitimately imports upstream).
 *   - Type-only imports (`import type … from 'semver'`) — no runtime dep.
 *   - A call site carrying `socket-lint: allow bare-semver`.
 */

import { makeBypassChecker } from '../../lib/comment-markers.mts'
import type { AstNode, RuleContext } from '../../lib/rule-types.mts'

// socket-lint: allow bare-semver -- opt-out for a wrapper/forwarder that
// genuinely needs the upstream package (e.g. socket-lib's own versions/* impl).
const BYPASS_RE = /socket-lint:\s*allow\s+bare-semver/

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Use '@socketsecurity/lib-stable/versions/*' instead of the bare 'semver' import.",
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      banned:
        "Bare 'semver' import — use '@socketsecurity/lib-stable/versions/*' instead: isValidVersion / coerceVersion / getMajorVersion (versions/parse), gt / lt / compare / sort / rsort (versions/compare), minVersion / maxVersion / satisfiesVersion (versions/range). The lib keeps semver a bundled dep so consumers carry no runtime semver.",
    },
    schema: [],
  },

  create(context: RuleContext) {
    const hasBypassComment = makeBypassChecker(context, BYPASS_RE)
    const filename = context.getFilename?.() ?? context.physicalFilename ?? ''
    // A wrapper file (socket-lib's own versions/* implementation) legitimately
    // imports the upstream package. Skip everything under src/external/.
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
        // Match `semver` or `semver/<subpath>` exactly. Reject substrings like
        // `my-semver`.
        if (spec !== 'semver' && !spec.startsWith('semver/')) {
          return
        }
        // Type-only imports don't ship runtime code; the runtime-dep concern
        // doesn't apply.
        if (node.importKind === 'type') {
          return
        }
        if (hasBypassComment(node)) {
          return
        }
        context.report({ node: source, messageId: 'banned' })
      },
    }
  },
}

// oxlint-disable-next-line socket/no-default-export -- oxlint plugin contract requires default-exported rule object.
export default rule
