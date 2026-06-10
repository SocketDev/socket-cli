// Cross-repo path matchers — shared by the commit-time scanCrossRepoPaths
// (.git-hooks/_shared/helpers.mts) and the edit-time cross-repo-guard
// (.claude/hooks/fleet/). Both built the identical regexes from
// FLEET_REPO_NAMES inline; this is the single source so they can't drift.
// Gate-free (no Node-25 hard-exit) so the Claude hook imports it on the
// operator's possibly-older Node. Each consumer keeps its own scanner FUNCTION
// (they differ in deps + doc-skip context); only the regexes are shared.
//
// A cross-repo reference is a `../<repo>/…` relative escape or a
// `…/projects/<repo>/…` absolute path into a sibling fleet repo. The fix is
// always an `@socketsecurity/<pkg>` package import, never a path.

import { FLEET_REPO_NAMES } from '../../.claude/hooks/fleet/_shared/fleet-repos.mts'

const FLEET_RE_FRAGMENT = FLEET_REPO_NAMES.join('|')

// `../<repo>/…` (any depth of `../`) preceded by a path boundary so we don't
// re-match a repo name already inside a longer token.
export const CROSS_REPO_RELATIVE_RE = new RegExp(
  String.raw`(?:^|[\s'"\`(=,])\.\.(?:/\.\.)*/(?:${FLEET_RE_FRAGMENT})/`,
)

// `…/projects/<repo>/…` — absolute or env-rooted variant. Catches cases where
// a personal-path scan was satisfied via `${HOME}` / `<user>` substitution but
// the path still escapes into another repo.
export const CROSS_REPO_ABSOLUTE_RE = new RegExp(
  String.raw`/projects/(?:${FLEET_RE_FRAGMENT})/`,
)

export const CROSS_REPO_ANY_RE = new RegExp(
  `${CROSS_REPO_RELATIVE_RE.source}|${CROSS_REPO_ABSOLUTE_RE.source}`,
)
