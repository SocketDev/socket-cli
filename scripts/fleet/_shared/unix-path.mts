/**
 * @file The dependency-free forward-slash converter. `normalizePath` from
 *   `@socketsecurity/lib-stable/paths/normalize` is the fleet's full
 *   normalizer (segment collapse, UNC + Windows-namespace preservation, MSYS
 *   drive letters) and stays the right call anywhere lib-stable is reachable.
 *   This leaf covers the dep-0 tier ONLY — modules that load on a bare
 *   checkout before any pnpm install (the release-reconcile gap job, hook
 *   scripts) and therefore cannot import lib-stable at all. Its inputs are
 *   already `path.join` / `path.relative` output, which node has collapsed,
 *   so the separator swap is the whole remaining job.
 */

/**
 * Convert every backslash in `pathLike` to a forward slash so a separator
 * -sensitive operation (a `split('/')`, a `startsWith('/')`, a regex match)
 * behaves identically on Windows and POSIX. Pass node-produced paths — this
 * leaf does not collapse `.` / `..` segments.
 */
export function toUnixPath(pathLike: string): string {
  return pathLike.replace(/\\/g, '/')
}
