/**
 * @file Soak-aware Node runtime-pin update runner for the fleet. The canonical
 *   Node pin lives in `.node-version` (the `node-version-sync` check cascades
 *   it to every member; the recent fleet bump touched only that file, so it is
 *   the sole file this runner maintains). This runner advances the pin only to
 *   a newer release of the SAME major line whose upstream RELEASE date has
 *   cleared the `--soak-days` trust window — the same discipline every
 *   ecosystem update runner applies, so a fresh Node release can't land before
 *   its soak. Node is nodejs-owned, third-party to the fleet, so it is NEVER
 *   soak-exempt; the Socket-provenance bypass that exempts `@socketsecurity/*`
 *   never applies here. Fail-closed: a release whose date can't be resolved is
 *   not a candidate. Modes: node scripts/fleet/update/node.mts --soak-days 7
 *   Dry plan (default): resolve nodejs/node releases via `gh api`, print the
 *   newest soak-cleared same-major bump it WOULD write (and any held-under-soak
 *   releases), touching nothing. node scripts/fleet/update/node.mts --soak-days
 *   7 --apply Apply: write the resolved version to `.node-version`. Release
 *   dates come from `gh api repos/nodejs/node/releases` (the sanctioned GitHub
 *   read path — never a raw api.github.com fetch, never an nodejs.org allowlist
 *   entry). The fetch seam is injectable so the unit tests drive every decision
 *   with canned release data and no network.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { compare, gt } from '@socketsecurity/lib-stable/versions/compare'
import {
  getMajorVersion,
  isValidVersion,
} from '@socketsecurity/lib-stable/versions/parse'
import { maxVersion } from '@socketsecurity/lib-stable/versions/range'

import { requireSoakDays } from './_shared.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const DAY_MS = 86_400_000

// The canonical fleet Node pin file, read/written relative to the repo root.
// `node-version-sync` cascades this one file to every member.
const NODE_VERSION_FILE = '.node-version'

/**
 * One nodejs/node release, normalized: the leading `v` stripped from the tag
 * and the publish date parsed. Only stable (non-prerelease) releases with a
 * valid semver tag and a parseable date survive `parseNodeReleases`.
 */
export interface NodeRelease {
  readonly publishedAt: Date
  readonly version: string
}

/**
 * A same-major release newer than the current pin, annotated with its age so
 * the planner can report both cleared bumps and the ones still under soak.
 */
export interface NodeBumpCandidate {
  readonly ageMs: number
  readonly publishedAt: Date
  readonly remainingMs: number
  readonly version: string
}

/**
 * The plan for a single `.node-version`: the current pin, the newest same-major
 * release that has cleared soak (`proposed`, absent when none is both cleared
 * AND newer than the current pin), and every same-major release newer than the
 * current pin still inside the soak window (`held`).
 */
export interface NodeBumpPlan {
  readonly current: string
  readonly held: readonly NodeBumpCandidate[]
  readonly proposed: string | undefined
}

/**
 * The raw shape of a GitHub release object as returned by
 * `gh api repos/nodejs/node/releases`. Only the three fields the planner needs
 * are typed; the rest are ignored.
 */
export interface RawNodeRelease {
  readonly prerelease?: boolean | undefined
  readonly published_at?: string | undefined
  readonly tag_name?: string | undefined
}

/**
 * A seam that yields the nodejs/node release list. Defaults to the `gh api`
 * implementation; the unit tests inject a canned list so no network is touched.
 */
export type FetchNodeReleases = () => Promise<readonly NodeRelease[]>

/**
 * Normalize a raw GitHub release list into `NodeRelease`s. Fail-closed: drops
 * prereleases, releases without a valid semver tag, and releases whose
 * `published_at` is missing or unparseable — an unverifiable date is never a
 * bump candidate. The leading `v` is stripped from the tag.
 */
export function parseNodeReleases(
  raw: readonly RawNodeRelease[],
): NodeRelease[] {
  const out: NodeRelease[] = []
  for (let i = 0, { length } = raw; i < length; i += 1) {
    const entry = raw[i]!
    if (entry.prerelease === true) {
      continue
    }
    const tag = entry.tag_name
    if (typeof tag !== 'string' || tag === '') {
      continue
    }
    const version = tag.startsWith('v') ? tag.slice(1) : tag
    if (!isValidVersion(version)) {
      continue
    }
    const rawDate = entry.published_at
    if (typeof rawDate !== 'string' || rawDate === '') {
      continue
    }
    const publishedAt = new Date(rawDate)
    if (Number.isNaN(publishedAt.getTime())) {
      continue
    }
    out.push({ publishedAt, version })
  }
  return out
}

/**
 * Decide the pin bump for one `.node-version`. Considers only releases in the
 * SAME major line as `current` that are strictly newer than it; partitions them
 * into soak-cleared vs still-held by publish age against `soakDays`. `proposed`
 * is the highest cleared version (or `undefined` when nothing cleared is newer
 * than the current pin). Pure — the primary unit-test target.
 */
export function planNodeBump(config: {
  readonly current: string
  readonly now: Date
  readonly releases: readonly NodeRelease[]
  readonly soakDays: number
}): NodeBumpPlan {
  const { current, now, releases, soakDays } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (!isValidVersion(current)) {
    throw new Error(
      'Invalid current Node pin.\n' +
        `  Where: ${NODE_VERSION_FILE}\n` +
        `  Saw: "${current}"; wanted a valid semver version (e.g. 26.5.0).\n` +
        `  Fix: correct ${NODE_VERSION_FILE} to a real Node release version.`,
    )
  }
  const soakMs = soakDays * DAY_MS
  const nowMs = now.getTime()
  const currentMajor = getMajorVersion(current)
  const cleared: string[] = []
  const held: NodeBumpCandidate[] = []
  for (let i = 0, { length } = releases; i < length; i += 1) {
    const release = releases[i]!
    if (getMajorVersion(release.version) !== currentMajor) {
      continue
    }
    if (!gt(release.version, current)) {
      continue
    }
    const ageMs = nowMs - release.publishedAt.getTime()
    if (ageMs >= soakMs) {
      cleared.push(release.version)
    } else {
      held.push({
        ageMs,
        publishedAt: release.publishedAt,
        remainingMs: soakMs - ageMs,
        version: release.version,
      })
    }
  }
  const proposed = cleared.length === 0 ? undefined : maxVersion(cleared)
  held.sort((a, b) => compare(b.version, a.version) ?? 0)
  return { current, held, proposed }
}

/**
 * Read the trimmed `.node-version` pin from `root`. Throws a What/Where/Saw/Fix
 * error when the file is missing or empty — the runner refuses to plan against
 * an absent pin rather than inventing one.
 */
export function readNodeVersion(root: string): string {
  const file = path.join(root, NODE_VERSION_FILE)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    throw new Error(
      'Missing Node pin file.\n' +
        `  Where: ${file}\n` +
        '  Saw: file unreadable/absent; wanted a one-line semver pin.\n' +
        `  Fix: create ${NODE_VERSION_FILE} with the pinned Node version.`,
    )
  }
  const trimmed = raw.trim()
  if (trimmed === '') {
    throw new Error(
      'Empty Node pin file.\n' +
        `  Where: ${file}\n` +
        '  Saw: empty contents; wanted a one-line semver pin.\n' +
        `  Fix: write the pinned Node version into ${NODE_VERSION_FILE}.`,
    )
  }
  return trimmed
}

/**
 * Write `version` to `root/.node-version`, matching the existing single-line +
 * trailing-newline shape the fleet pin file uses.
 */
export function writeNodeVersion(root: string, version: string): void {
  writeThroughMirrorLock(path.join(root, NODE_VERSION_FILE), `${version}\n`)
}

/**
 * Resolve the nodejs/node stable-release list through the sanctioned `gh api`
 * read path. `per_page=100` covers well beyond one major line's release
 * history. Never touches api.github.com directly (hook-blocked) and never adds
 * nodejs.org to an allowlist.
 */
export async function fetchNodeReleasesViaGhApi(): Promise<NodeRelease[]> {
  const result = await spawn(
    'gh',
    ['api', 'repos/nodejs/node/releases?per_page=100'],
    { stdio: ['ignore', 'pipe', 'pipe'], stdioString: true },
  )
  const stdout = String(result.stdout ?? '')
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(
      'Could not parse nodejs/node release JSON.\n' +
        '  Where: gh api repos/nodejs/node/releases\n' +
        '  Saw: non-JSON output; wanted a JSON release array.\n' +
        '  Fix: check `gh auth status` and GitHub reachability, then retry.',
    )
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      'Unexpected nodejs/node release payload.\n' +
        '  Where: gh api repos/nodejs/node/releases\n' +
        '  Saw: non-array JSON; wanted a JSON release array.\n' +
        '  Fix: check the GitHub API response shape, then retry.',
    )
  }
  return parseNodeReleases(parsed as readonly RawNodeRelease[])
}

/**
 * The exact version named by `--soak-bypass <x.y.z>`, or undefined when the
 * flag is absent. Value-required: a bare flag is reported as absent and the
 * caller's index lookup then fails loud on the unpublished "version". Pure —
 * exported for tests.
 */
export function soakBypassVersion(argv: readonly string[]): string | undefined {
  const at = argv.indexOf('--soak-bypass')
  if (at === -1) {
    return undefined
  }
  return argv[at + 1]
}

/**
 * CLI entry. Dry-plans (default) or applies (`--apply`) the soak-cleared
 * same-major Node pin bump. `soakDays` comes from `--soak-days <n>` (the
 * orchestrator passes the fleet soak); it is never hardcoded. `fetchReleases`
 * is injectable so tests drive the flow without `gh` or the network. Returns a
 * process exit code.
 */
export async function main(
  argv: readonly string[],
  fetchReleases: FetchNodeReleases = fetchNodeReleasesViaGhApi,
): Promise<number> {
  const apply = argv.includes('--apply')
  let soakDays: number
  try {
    soakDays = requireSoakDays(argv, 'update/node')
  } catch (e) {
    logger.error(errorMessage(e))
    return 2
  }
  const root = REPO_ROOT
  let current: string
  try {
    current = readNodeVersion(root)
  } catch (e) {
    logger.error(errorMessage(e))
    return 1
  }
  const releases = await fetchReleases()
  const bypassVersion = soakBypassVersion(argv)
  if (bypassVersion) {
    // The dated-waiver escape, same rationale as an external-tools
    // `soakBypass` entry: nodejs.org release assets come from a known
    // publisher, the soak targets registry typosquats and malicious
    // freshpubs, and the OPERATOR names the exact version — this flag never
    // picks one. Still same-major, still a real published release.
    const release = releases.find(r => r.version === bypassVersion)
    if (!release) {
      logger.error(
        'update/node: --soak-bypass names an unpublished version\n' +
          `  Where: the ${getMajorVersion(current)}.x release index.\n` +
          `  Saw: ${bypassVersion}; wanted a version the index lists.\n` +
          '  Fix: name an exact published release, e.g. --soak-bypass 26.7.0.',
      )
      return 1
    }
    if (getMajorVersion(bypassVersion) !== getMajorVersion(current)) {
      logger.error(
        'update/node: --soak-bypass crosses the major line\n' +
          `  Where: ${NODE_VERSION_FILE} pins ${current}.\n` +
          `  Saw: ${bypassVersion}; wanted ${getMajorVersion(current)}.x.\n` +
          '  Fix: major bumps are a deliberate migration, not a pin advance.',
      )
      return 1
    }
    if (!apply) {
      logger.info(
        `update/node: would bump ${current} -> ${bypassVersion} (soak WAIVED by --soak-bypass). Re-run with --apply to write ${NODE_VERSION_FILE}.`,
      )
      return 0
    }
    writeNodeVersion(root, bypassVersion)
    logger.success(
      `update/node: wrote ${bypassVersion} to ${NODE_VERSION_FILE} (was ${current}; soak waived by --soak-bypass, operator-named).`,
    )
    return 0
  }
  const plan = planNodeBump({ current, now: new Date(), releases, soakDays })

  logger.info(
    `update/node: current pin ${plan.current} (soak ${soakDays}d, same major ${getMajorVersion(plan.current)}.x).`,
  )
  for (let i = 0, { length } = plan.held; i < length; i += 1) {
    const candidate = plan.held[i]!
    logger.info(
      `  held: ${candidate.version} — ${Math.ceil(candidate.remainingMs / DAY_MS)}d left of ${soakDays}d soak`,
    )
  }
  if (!plan.proposed) {
    logger.info(
      'update/node: no soak-cleared release newer than the current pin — nothing to do.',
    )
    return 0
  }
  if (!apply) {
    logger.info(
      `update/node: would bump ${plan.current} -> ${plan.proposed}. Re-run with --apply to write ${NODE_VERSION_FILE}.`,
    )
    return 0
  }
  writeNodeVersion(root, plan.proposed)
  logger.success(
    `update/node: wrote ${plan.proposed} to ${NODE_VERSION_FILE} (was ${plan.current}).`,
  )
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'advances the .node-version pin to the newest soak-cleared release of the same major line',
  help: `Usage: node scripts/fleet/update/node.mts --soak-days <n> [flags]

  --soak-days <n>       soak window in days (required trust gate)
  (no mode flag)        dry plan: print the bump it would write, touching nothing
  --apply               write the resolved version to .node-version
  --soak-bypass <x.y.z> waive the soak for one OPERATOR-NAMED same-major
                        release (nodejs.org is a known publisher; the soak
                        targets registry typosquats) — never picks a version`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(() => main(process.argv.slice(2)), SCRIPT_META)
}
/* c8 ignore stop */
