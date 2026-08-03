/*
 * Squashing-history runner — the pre-flight guards that decide whether a
 * squash may proceed at all, before any worktree or history rewrite starts.
 * Each guard returns `undefined` to let main() continue, or the process exit
 * code main() should return immediately.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import {
  isOptedIn,
  loadRosterFromRepo,
} from '../../../hooks/fleet/_shared/fleet-roster.mts'
import { run } from '../_shared/scripts/run-helpers.mts'
import { gitPorcelain } from '../../../../scripts/fleet/_shared/git-porcelain.mts'
import {
  crateNamesFromCargoManifest,
  npmPackageNameFromManifest,
} from '../../../../scripts/fleet/_shared/member-release-probe.mts'
import { resolveCrateReleaseSha } from '../../../../scripts/fleet/crate-release-sha.mts'
import { fetchPublishedVersionChecked } from '../../../../scripts/fleet/publish-infra/cargo/registry.mts'
import { fetchLatestGitHead } from '../../../../scripts/fleet/publish-infra/npm/registry.mts'
import {
  PLACEHOLDER_VERSION,
  publishedReleaseBlocksSquash,
  resolveFreezeBoundary,
} from '../../../../scripts/fleet/lib/squash-publish-guard.mts'

import type {
  FreezeAncestryInfo,
  FreezeAnchorCandidate,
} from '../../../../scripts/fleet/lib/squash-publish-guard.mts'

const logger = getDefaultLogger()

// A workspace directory (`packages/*`, `crates/*`) contributes at most this
// many manifests to the freeze-boundary probe. A registry-scale monorepo has
// hundreds of directories; past the cap the probe stops widening rather than
// issuing hundreds of registry reads for one squash run.
const MAX_WORKSPACE_ENTRIES = 25

/**
 * Code-is-law opt-in gate. Squash is destructive history rewrite, so the
 * ROSTER decides which repos it may touch — not a path arg a human, or a
 * fuzzy name-match, points at. A non-fleet repo, no roster, or absent from
 * it, is refused outright: this is the guard that stops a `cdxgen` from being
 * squashed because it resembles `sdxgen`.
 *
 * The published-release safeguard is a SEPARATE step
 * (`resolveFreezeBoundaryForRepo`) — a real release no longer refuses the
 * squash outright, it sets the freeze boundary the squash collapses ABOVE.
 */
export async function checkSquashAllowed(config: {
  readonly fleetName: string
  readonly src: string
}): Promise<number | undefined> {
  const cfg = { __proto__: null, ...config } as {
    fleetName: string
    src: string
  }
  const { fleetName, src } = cfg

  const roster = loadRosterFromRepo(src)
  if (!roster) {
    logger.error(
      `error: ${src} carries no fleet roster (cascading-fleet/lib/` +
        `fleet-repos.json) — it is not a fleet repo, so squash is refused. ` +
        `Squash only opted-in fleet members.`,
    )
    return 2
  }
  if (!isOptedIn(roster, fleetName, 'squash-history')) {
    logger.error(
      `error: ${fleetName} is not opted into 'squash-history' in the fleet ` +
        `roster — refusing to rewrite its history. ` +
        `Saw: no 'squash-history' in its optIns; wanted the opt-in. ` +
        `Fix: add "${fleetName}" with optIns:['squash-history'] to ` +
        `cascading-fleet/lib/fleet-repos.json (then cascade), or squash a ` +
        `repo that is already opted in.`,
    )
    return 2
  }
  return undefined
}

// Every manifest TEXT for one packaging surface, read from the LOCAL
// checkout: the root manifest, then one workspace directory down
// (`packages/*` for npm, `crates/*` for cargo) — the local mirror of
// `member-release-probe.mts`'s remote (GH API) surface reader, since this
// guard runs against a checkout on disk, not another repo over the network.
function localManifestTexts(
  src: string,
  rootName: string,
  workspaceDir: string,
): string[] {
  const texts: string[] = []
  const rootPath = path.join(src, rootName)
  if (existsSync(rootPath)) {
    texts.push(readFileSync(rootPath, 'utf8'))
  }
  const dir = path.join(src, workspaceDir)
  if (!existsSync(dir)) {
    return texts
  }
  let entries: string[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch {
    entries = []
  }
  for (
    let i = 0, { length } = entries;
    i < length && i < MAX_WORKSPACE_ENTRIES;
    i += 1
  ) {
    const manifestPath = path.join(dir, entries[i]!, rootName)
    if (existsSync(manifestPath)) {
      texts.push(readFileSync(manifestPath, 'utf8'))
    }
  }
  return texts
}

// Every freeze-anchor candidate this checkout's manifests declare, plus
// whether ANY of them is a REAL published release, plus every declared
// package/crate whose registry READ itself failed (network/timeout — NOT the
// registry answering "never published"). The distinction matters: a read
// FAILURE must never look like "confirmed unpublished" to the caller —
// `resolveFreezeBoundaryForRepo` uses `readFailures` (together with the
// local, network-independent manifest floor) to refuse rather than silently
// treat an unreadable registry as full-root-safe.
async function collectFreezeAnchors(src: string): Promise<{
  candidates: FreezeAnchorCandidate[]
  published: boolean
  readFailures: string[]
}> {
  const candidates: FreezeAnchorCandidate[] = []
  const readFailures: string[] = []
  let published = false

  const npmTexts = localManifestTexts(src, 'package.json', 'packages')
  for (let i = 0, { length } = npmTexts; i < length; i += 1) {
    const name = npmPackageNameFromManifest(npmTexts[i]!)
    if (name === undefined) {
      continue
    }
    let read: Awaited<ReturnType<typeof fetchLatestGitHead>>
    try {
      read = await fetchLatestGitHead(name)
    } catch {
      readFailures.push(`npm:${name}`)
      continue
    }
    if (!read.reachable) {
      readFailures.push(`npm:${name}`)
      continue
    }
    if (!read.version) {
      // The registry answered: confirmed never published. Not a failure.
      continue
    }
    if (!publishedReleaseBlocksSquash('npm', read.version)) {
      continue
    }
    published = true
    candidates.push({
      sha: read.sha,
      source: `npm:${name}@${read.version}`,
    })
  }

  const cargoTexts = localManifestTexts(src, 'Cargo.toml', 'crates')
  for (let i = 0, { length } = cargoTexts; i < length; i += 1) {
    const names = crateNamesFromCargoManifest(cargoTexts[i]!)
    for (let j = 0, count = names.length; j < count; j += 1) {
      const crateName = names[j]!
      // Reachability first (fetchPublishedVersionChecked distinguishes a
      // network failure from crates.io answering "never published"), same
      // shape as the npm branch above. resolveCrateReleaseSha alone cannot
      // make that distinction — it returns undefined on EITHER a network
      // failure or a genuinely unpublished crate.
      let latestRead: Awaited<ReturnType<typeof fetchPublishedVersionChecked>>
      try {
        latestRead = await fetchPublishedVersionChecked(crateName)
      } catch {
        readFailures.push(`crate:${crateName}`)
        continue
      }
      if (!latestRead.reachable) {
        readFailures.push(`crate:${crateName}`)
        continue
      }
      if (!publishedReleaseBlocksSquash('cargo', latestRead.latest)) {
        continue
      }
      published = true
      let info: Awaited<ReturnType<typeof resolveCrateReleaseSha>>
      try {
        info = await resolveCrateReleaseSha(crateName)
      } catch {
        info = undefined
      }
      candidates.push({
        sha: info?.sha,
        source: `crate:${crateName}@${latestRead.latest}`,
      })
    }
  }

  return { candidates, published, readFailures }
}

// The same network-independent floor the manual-flatten guard
// (squash-freeze-boundary-guard's `repoHasLikelyFrozenZone`) uses: a root
// manifest reporting a REAL (non-placeholder) version. Duplicated rather than
// imported — that hook module runs itself as a Claude Code hook on import
// (`runHook` at its own bottom), the same reason its PLACEHOLDER_VERSION
// constant is inlined there rather than imported.
function localManifestReportsRealVersion(src: string): boolean {
  const pkgPath = path.join(src, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        version?: unknown | undefined
      }
      if (
        typeof pkg.version === 'string' &&
        pkg.version !== '' &&
        pkg.version !== PLACEHOLDER_VERSION
      ) {
        return true
      }
    } catch {}
  }
  const cargoPath = path.join(src, 'Cargo.toml')
  if (existsSync(cargoPath)) {
    try {
      const text = readFileSync(cargoPath, 'utf8')
      const m = /^\s*version\s*=\s*"([^"]*)"/m.exec(text)
      if (m?.[1] && m[1] !== PLACEHOLDER_VERSION) {
        return true
      }
    } catch {}
  }
  return false
}

/**
 * Ancestry for a set of candidate SHAs against `tip` — the branch commit
 * about to be squashed — via `git merge-base --is-ancestor` plus `git
 * rev-list --count <sha>..<tip>` (only computed when the ancestor check
 * holds; ranking a rejected candidate is pointless).
 */
async function computeHeadAncestry(
  src: string,
  tip: string,
  shas: readonly string[],
): Promise<Map<string, FreezeAncestryInfo>> {
  const map = new Map<string, FreezeAncestryInfo>()
  for (let i = 0, { length } = shas; i < length; i += 1) {
    const sha = shas[i]!
    if (map.has(sha)) {
      continue
    }
    const isAncestor =
      (
        await run('git', ['merge-base', '--is-ancestor', sha, tip], src, {
          allowFailure: true,
        })
      ).code === 0
    let distance = Number.POSITIVE_INFINITY
    if (isAncestor) {
      distance = Number(
        (await run('git', ['rev-list', '--count', `${sha}..${tip}`], src))
          .stdout || '0',
      )
    }
    map.set(sha, { distance, isAncestor })
  }
  return map
}

export interface FreezeBoundaryResolution {
  /**
   * The newest ancestor-verified published-release SHA to freeze at, or
   * `undefined` when a full-root squash is safe (nothing published).
   */
  readonly boundary?: string | undefined
  /**
   * Set when the repo has a confirmed published release with no safe anchor
   * to freeze at — the caller must refuse the squash (exit 2) rather than
   * proceed with `boundary: undefined`, which would read as "safe to
   * full-flatten".
   */
  readonly refuseMessage?: string | undefined
}

/**
 * Resolve this checkout's squash-freeze boundary against `tip`: discover
 * every npm package/crate this repo (root + one workspace level) declares,
 * probe each registry for a REAL published release + its source commit,
 * verify ancestry, and hand the set to the pure `resolveFreezeBoundary`.
 *
 * Two fail-loud cases turn into a `refuseMessage` (main() logs it, exits 2)
 * instead of `boundary: undefined` (full-root safe):
 * - `resolveFreezeBoundary`'s own "unresolvable anchor" throw.
 * - A registry read FAILURE (network/timeout) for every candidate, when the
 * LOCAL manifest reports a real (non-placeholder) version. A read failure
 * isn't the same as "never published", but the pure function can't tell
 * them apart from here — treating it as full-root-safe would silently
 * orphan a genuinely published release the instant the registry hiccups.
 */
export async function resolveFreezeBoundaryForRepo(config: {
  readonly src: string
  readonly tip: string
}): Promise<FreezeBoundaryResolution> {
  const cfg = { __proto__: null, ...config } as { src: string; tip: string }
  const { src, tip } = cfg

  const { candidates, published, readFailures } =
    await collectFreezeAnchors(src)
  const shas = candidates
    .map(c => c.sha)
    .filter((sha): sha is string => sha !== undefined)
  const headAncestry = await computeHeadAncestry(src, tip, shas)

  try {
    const boundary = resolveFreezeBoundary({
      candidates,
      headAncestry,
      published,
    })
    if (
      boundary === undefined &&
      readFailures.length > 0 &&
      localManifestReportsRealVersion(src)
    ) {
      throw new Error(
        "resolveFreezeBoundaryForRepo: this checkout's local manifest " +
          'reports a REAL published version, but the registry read(s) ' +
          'needed to resolve a freeze boundary FAILED rather than ' +
          'confirming "never published".\n' +
          `  Where: ${readFailures.join(', ')}.\n` +
          '  Saw: a network/timeout failure on a package/crate registry ' +
          'read, not a definitive "unpublished" answer.\n' +
          '  Wanted: either a resolved-and-ancestor-verified freeze ' +
          'boundary, or registry confirmation this repo has never ' +
          'published (0.0.0).\n' +
          '  Fix: retry once registry connectivity is restored — ' +
          'refusing rather than silently full-flattening a possibly-' +
          'released repo.',
      )
    }
    return { boundary }
  } catch (e) {
    return {
      refuseMessage: errorMessage(e),
    }
  }
}

/**
 * A shallow clone's commit graph is grafted, so `rev-list --count` reports
 * the fetch depth, not the branch's true history — a depth-1 clone always
 * reads as "already squashed" and the single-commit early-exit silently
 * no-ops on a full-history remote. Refuse loudly; unshallow first (or squash
 * via a tree snapshot, which needs no history).
 */
export async function checkNotShallowClone(config: {
  readonly base: string
  readonly src: string
}): Promise<number | undefined> {
  const cfg = { __proto__: null, ...config } as { base: string; src: string }
  const { base, src } = cfg

  const shallow = (
    await run('git', ['rev-parse', '--is-shallow-repository'], src)
  ).stdout
  if (shallow === 'true') {
    logger.error(
      `error: ${src} is a SHALLOW clone — its local graph cannot answer ` +
        `"how many commits does origin/${base} have". ` +
        `Saw a grafted history; wanted the full graph. ` +
        `Fix: git -C ${src} fetch --unshallow origin ${base}, then re-run.`,
    )
    return 2
  }
  return undefined
}

// Dirty paths listed verbatim in the refusal before it truncates. Long enough
// to identify the work, short enough that the fix stays on screen.
const MAX_LISTED_DIRTY = 10

/**
 * Refuse to squash over an uncommitted working tree.
 *
 * Every squash mode collapses COMMITTED history — the root is minted from
 * the branch tip, so anything living only in the working tree is stranded on
 * top of rewritten history, where the flow's own recovery advice (`git reset
 * --hard <newHead>`) destroys it. That's strictly worse than the stale-tree
 * clobber `stale-tree-clobber-guard` catches at commit time: this one loses
 * work rather than reverting it.
 *
 * The remedy is standing fleet doctrine
 * (`docs/agents.md/fleet/parallel-claude-sessions.md`): commit first, then
 * squash, never the reverse — the message teaches landing forward, never
 * stash/branch/wait.
 *
 * IGNORED files are exempt BY CONSTRUCTION: this reads `git status
 * --porcelain` WITHOUT `--ignored`, so a dirty `dist/`/`node_modules/` is
 * invisible here. Untracked-but-NOT-ignored files DO block — an uncommitted
 * new source file is exactly the work a collapse strands.
 */
export function checkTreeIsClean(config: {
  readonly src: string
}): number | undefined {
  const cfg = { __proto__: null, ...config } as { src: string }
  const { src } = cfg

  // untrackedAll: list `src/new-thing.mts`, not a collapsed `?? src/` — the
  // remedy below is a pathspec commit, so the operator needs the file paths.
  const status = gitPorcelain(src, { untrackedAll: true })
  if (!status.ok) {
    logger.error(
      `error: could not read the working-tree status of ${src} — refusing ` +
        `to squash. Saw a failing \`git status --porcelain\`; wanted a ` +
        `readable tree state. Fix: resolve the git error above, then re-run.`,
    )
    return 2
  }
  const { entries } = status
  if (entries.length === 0) {
    return undefined
  }

  const listed = entries
    .slice(0, MAX_LISTED_DIRTY)
    .map(e => `    ${e.status} ${e.path}`)
    .join('\n')
  const more =
    entries.length > MAX_LISTED_DIRTY
      ? `\n    ... and ${entries.length - MAX_LISTED_DIRTY} more`
      : ''
  logger.error(
    `error: ${src} has an UNCOMMITTED working tree — refusing to squash.\n` +
      `${listed}${more}\n\n` +
      `  A squash collapses COMMITTED history, so these ${entries.length} ` +
      `path(s) are\n` +
      `  excluded from the collapse and left stranded on top of rewritten\n` +
      `  history — where this flow's own recovery step (git reset --hard)\n` +
      `  destroys them. Ignored files are already exempt; these are not.\n\n` +
      `  Fix — land the dirty files FIRST, then squash. Commit with an\n` +
      `  explicit pathspec (never \`git add -A\`, it sweeps a parallel\n` +
      `  session's files):\n` +
      `    git -C ${src} add -- <your-paths>\n` +
      `    git -C ${src} commit -m "chore: land before squash"\n` +
      `    # then re-run the squash\n\n` +
      `  Do NOT stash, do NOT branch, do NOT wait for a quiet window —\n` +
      `  history flattens anyway, so any subject will do. See\n` +
      `  docs/agents.md/fleet/parallel-claude-sessions.md ("Land the dirty\n` +
      `  files BEFORE squashing").`,
  )
  return 2
}
