/*
 * @file Recognize the repo-tier test home `test/repo/{unit,integration,e2e}/`.
 *   Hook / lint-rule / git-hook tests live here (relocated out of the cascaded
 *   trees so members don't ship them), and test code carries deliberately "bad"
 *   code as FIXTURES — the very patterns a rule or guard detects: a `delete`, an
 *   inline `type` import, a `node:child_process` import, a boolean positional
 *   param, a `node:test` import. A CONVENTION/content guard scanning those
 *   fixture strings is always a false positive, so affected guards self-exempt
 *   this home the same way they exempt the co-located rule sources under
 *   `.config/fleet/oxlint-plugin/fleet/<id>/`. Fleet-wide, not wheelhouse-only:
 *   every repo's `test/repo/` is repo-owned test code, never production source.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// A file under the repo test home. Path normalized to `/` first so the regex
// stays single-separator; matched against an absolute or repo-relative path.
const REPO_TEST_HOME_RE = /(?:^|\/)test\/repo\/(?:unit|integration|e2e)\//

export function isRepoTestHome(filePath: string): boolean {
  return REPO_TEST_HOME_RE.test(normalizePath(filePath))
}
