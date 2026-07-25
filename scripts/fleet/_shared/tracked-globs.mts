/**
 * @file Gitignore- and submodule-aware file collector for the fleet checks and
 *   FS-walkers. `collectTrackedFiles` globs a repo for the requested patterns
 *   and keeps only the git-TRACKED matches, so a walk never reports (or even
 *   descends into) a gitignored tree or a git-submodule mount: the reference
 *   submodules under `upstream/`, `node_modules/`, build/cache output, and any
 *   path a repo's own `.gitignore` excludes.
 *   Why the tracked-set intersection is the correct filter: `globSync` honors
 *   only its static `ignore` list, and npm-packlist's `defaultIgnore` covers
 *   `node_modules`/`.git` but NOT `upstream/` or a repo-specific `.gitignore`
 *   entry — so a bare `globSync(['**\/package.json'])` picks up e.g.
 *   `upstream/actions-checkout/package.json`. Git, by contrast, never tracks an
 *   ignored path and lists a submodule as a single gitlink (never its
 *   contents), so `git ls-files` IS exactly "the tree minus gitignored minus
 *   submodule-internal". Intersecting the glob matches with that set gets the
 *   exclusion right by construction, using git's own ignore engine instead of a
 *   reimplemented `.gitignore` parser or a hand-maintained skip list.
 *   The glob still runs, preserving each caller's pattern + `dot` scope, with
 *   `defaultIgnore` and the submodule mounts spread into `ignore` so the walk
 *   skips the big trees up front instead of collecting-then-discarding them.
 *   When the tracked set is empty (a non-git directory — e.g. a `mkdtemp` unit
 *   fixture) the intersection is skipped and the glob result stands, so tests
 *   over a fixture tree keep working.
 */

import path from 'node:path'

import { getSubmodulePaths } from '@socketsecurity/lib-stable/git/tracked'
import { defaultIgnore } from '@socketsecurity/lib-stable/globs/defaults'
import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export interface CollectTrackedFilesConfig {
  /**
   * The repo (or subtree) root the patterns and the git query resolve against.
   */
  readonly cwd: string
  /**
   * Return absolute paths instead of `cwd`-relative ones.
   *
   * @default false
   */
  readonly absolute?: boolean | undefined
  /**
   * Match dotfiles and dot-directories. Omitted follows the `globSync` default
   * (off), so a caller keeps its existing scope unless it opts in.
   */
  readonly dot?: boolean | undefined
  /**
   * Extra ignore globs, merged after `defaultIgnore` + the submodule mounts.
   */
  readonly ignore?: readonly string[] | undefined
}

/**
 * The repo-root-relative, forward-slash paths git tracks under `cwd`. Reads
 * `git ls-files -z` (NUL-delimited, so paths with odd characters survive
 * untouched). Empty on any failure — a non-git directory or a missing git
 * binary — so callers fail open to the glob result, the fleet convention for
 * these porcelain reads.
 */
async function listTrackedFiles(cwd: string): Promise<string[]> {
  let stdout: Buffer | string | undefined
  try {
    const result = (await spawn('git', ['ls-files', '-z'], {
      cwd,
      stdioString: false,
    })) as { stdout?: Buffer | string | undefined }
    stdout = result.stdout
  } catch {
    return []
  }
  const text =
    typeof stdout === 'string' ? stdout : stdout ? stdout.toString('utf8') : ''
  const paths: string[] = []
  const entries = text.split('\0')
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (entry) {
      paths.push(normalizePath(entry))
    }
  }
  return paths
}

/**
 * Glob `patterns` under `options.cwd` and keep only the git-tracked matches,
 * dropping gitignored paths and git-submodule contents. See the file header for
 * the why. Returns `cwd`-relative forward-slash paths (or absolute when
 * `options.absolute` is set), in `globSync` order.
 */
export async function collectTrackedFiles(
  patterns: readonly string[],
  config: CollectTrackedFilesConfig,
): Promise<string[]> {
  const cfg = { __proto__: null, ...config } as CollectTrackedFilesConfig
  const { absolute = false, cwd } = cfg
  const submodulePaths = await getSubmodulePaths({ cwd })
  const ignore = [
    ...defaultIgnore,
    ...submodulePaths.map(mount => `${mount}/**`),
    ...(cfg.ignore ?? []),
  ]
  const candidates = globSync([...patterns], {
    absolute: false,
    cwd,
    ...(cfg.dot === undefined ? {} : { dot: cfg.dot }),
    ignore,
  })
  const tracked = await listTrackedFiles(cwd)
  // A non-git directory (e.g. a mkdtemp fixture) yields no tracked set; fall
  // back to the glob result so the static ignore + submodule mounts still apply.
  const trackedSet = tracked.length ? new Set(tracked) : undefined
  const result: string[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const normalized = normalizePath(candidates[i]!)
    if (trackedSet && !trackedSet.has(normalized)) {
      continue
    }
    result.push(
      absolute ? normalizePath(path.join(cwd, normalized)) : normalized,
    )
  }
  return result
}
