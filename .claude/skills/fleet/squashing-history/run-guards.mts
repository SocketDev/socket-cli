/*
 * Squashing-history runner — the pre-flight guards that decide whether a
 * squash may proceed at all, before any worktree or history rewrite starts.
 * Each guard returns `undefined` to let main() continue, or the process exit
 * code main() should return immediately.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import {
  isOptedIn,
  loadRosterFromRepo,
  publishProfile,
} from '../../../hooks/fleet/_shared/fleet-roster.mts'
import { run } from '../_shared/scripts/run-helpers.mts'
import { publishedReleaseBlocksSquash } from '../../../../scripts/fleet/lib/squash-publish-guard.mts'
import { fetchPublishedVersion } from '../../../../scripts/fleet/publish-infra/cargo/registry.mts'
import { fetchLatestPublishedVersion } from '../../../../scripts/fleet/publish-infra/npm/registry.mts'

const logger = getDefaultLogger()

/**
 * Code-is-law opt-in gate plus published-release safeguard, in one guard.
 *
 * Opt-in: squash is destructive history rewrite, so the ROSTER decides which
 * repos it may touch — not a path arg a human (or a fuzzy name-match) points
 * at. A non-fleet repo (no roster, or absent from it) is refused outright:
 * this is the guard that stops a `cdxgen` from being squashed because it
 * resembles `sdxgen`.
 *
 * Published-release safeguard: a full-root squash is safe for a repo whose
 * crates.io / npm names are still 0.0.0 placeholders, but it ERASES the
 * published-release history of a repo that has cut a REAL release. Detect a
 * real published version and REFUSE — a published repo keeps its history and
 * consolidates only the range since its last publish. Fail-OPEN: a registry
 * read error must NOT block a legit squash (the opt-in check above is the
 * primary control), so any lookup failure leaves `latest` undefined and the
 * squash proceeds.
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

  const publishes = publishProfile(roster, fleetName)
  let latest: string | undefined
  try {
    if (publishes === 'cargo') {
      // Crate names match repo names in the fleet.
      latest = await fetchPublishedVersion(fleetName)
    } else if (publishes === 'js' || publishes === 'npm') {
      // An npm package name is frequently SCOPED (e.g. @socketsecurity/sdk) and
      // differs from the repo/fleet name, so resolve it from the target's
      // package.json; fall back to fleetName when it is absent / private /
      // unparsable.
      let pkgName = fleetName
      const pkgPath = path.join(src, 'package.json')
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          name?: unknown | undefined
          private?: unknown | undefined
        }
        if (typeof pkg.name === 'string' && pkg.name && pkg.private !== true) {
          pkgName = pkg.name
        }
      }
      latest = await fetchLatestPublishedVersion(pkgName)
    }
  } catch {}
  const block = publishedReleaseBlocksSquash(publishes, latest)
  if (block) {
    logger.error(
      `error: ${fleetName} has a published ${block.registry} release ` +
        `(${block.version}) — refusing a full-root squash (it erases ` +
        `published-release history). Fix: remove 'squash-history' from ` +
        `"${fleetName}" in cascading-fleet/lib/fleet-repos.json (a published ` +
        `repo keeps its history), then consolidate only the range since the ` +
        `last publish: git reset --soft <publish-sha> (SHA is in the ` +
        `published .crate's .cargo_vcs_info.json / the npm tarball's gitHead).`,
    )
    return 2
  }
  return undefined
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
