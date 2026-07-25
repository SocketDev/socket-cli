/**
 * @file Files-field coverage — the one matcher for "would npm pack this
 *   path?", shared by the pack-contents gate (classifying real tarball
 *   entries) and the publish pack surface (predicting the pack file set when
 *   pruning repo-only lifecycle scripts). Dependency-light: node builtins
 *   plus the path normalizer only.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

/**
 * True when a tarball-relative path is covered by a package.json `files`
 * entry (a listed file, or anything under a listed directory). A missing /
 * empty `files` field covers everything (npm's default). Pure.
 */
export function isCoveredByFiles(
  entry: string,
  filesField: readonly string[] | undefined,
): boolean {
  if (!filesField || filesField.length === 0) {
    return true
  }
  const e = normalizePath(entry)
  for (const f of filesField) {
    const nf = normalizePath(f).replace(/\/+$/, '')
    if (e === nf || e.startsWith(`${nf}/`)) {
      return true
    }
    // A simple one-level glob (`lib/*.js`) — match by prefix + suffix.
    if (nf.includes('*')) {
      const [pre = '', post = ''] = nf.split('*', 2)
      if (e.startsWith(pre) && e.endsWith(post)) {
        return true
      }
    }
  }
  return false
}
