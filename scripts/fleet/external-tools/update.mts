/* max-file-lines: orchestration — soak-clear → fetch-latest → rewrite pipeline for both tool entry shapes; the phases share the soak-policy + entry-shape state. */
/**
 * @file Bump external-tools.json entries to their newest soak-cleared release.
 *   "Soak-cleared" means published longer ago than `minimumReleaseAge` minutes,
 *   read from the repo's own `pnpm-workspace.yaml`. That mirrors the soak pnpm
 *   applies to npm catalog entries — same policy, a different distribution
 *   channel. Integrity is always recomputed from the bytes actually downloaded,
 *   never transcribed from a publisher-declared hash. A pin only ever moves
 *   FORWARD; see `isForwardBump` for the two downgrades that invariant stops.
 *   Both entry shapes are keyed by `repository`. A GitHub release asset carries
 *   `release: 'asset'`, `repository: 'github:owner/repo'`, `version`, and a
 *   `platforms` map holding each platform's asset name and integrity; the
 *   releases API picks the highest soak-cleared semver tag, then every platform
 *   asset is downloaded and re-hashed into an SRI `sha512-<base64>`. An npm
 *   registry tarball carries no `release`, plus `repository: 'npm:<name>'`,
 *   `version`, and ONE top-level `integrity`; the registry packument picks the
 *   newest soak-cleared version and its `dist.integrity`. A tool bumped while
 *   still inside its soak window carries a dated `soakBypass` block of
 *   `version`, `published`, and `removable`. A bump that has cleared the window
 *   drops any stale block, and `external-tools/prune.mts` owns retiring a block
 *   whose window has since closed. Dry-run is the DEFAULT: the plan prints and
 *   nothing is written. `--apply` flushes. Idempotent — re-running against an
 *   up-to-date manifest is a no-op. Every shipped manifest is swept unless
 *   `--target <file>` narrows it to one, matching the sibling list / show /
 *   edit / prune / delete verbs.
 */

import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

// Fleet convention (socket/prefer-async-spawn): use the lib's
// spawnSync, not node:child_process. Drop `encoding:` from options —
// the lib's `stdioString: true` default already returns strings.
// oxlint-disable-next-line socket/prefer-async-spawn -- audit/cascade script needs sync stdin/stdout + typed string return; v5 lib spawnSync omits 'encoding' from SpawnSyncOptions and returns string-or-Buffer. v6 lib, when published, will obviate this.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { fetchPackageManifest } from '@socketsecurity/lib/packages/manifest'
import { gt } from '@socketsecurity/lib-stable/versions/compare'
import { coerceVersion } from '@socketsecurity/lib-stable/versions/parse'
import { maxVersion } from '@socketsecurity/lib-stable/versions/range'

import { writeThroughMirrorLock } from '../_shared/mirror-lock.mts'
import { isSocketSourcedPackage } from '../constants/socket-scopes.mts'
import { relPath, requireValue, resolveTargets } from './_shared.mts'
import { computeSoakBypass, planGithubUpdate } from './github.mts'

import { PNPM_WORKSPACE_YAML, REPO_ROOT } from '../paths.mts'
import { isSoakExcluded, readSoakRules } from '../soak-rules.mts'
import type { SoakRules } from '../soak-rules.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

// Inline soak-bypass annotation: a version adopted while still inside the 7-day
// minimumReleaseAge soak carries this so the install-time soak check honors it
// until `removable`; dropped once the release clears the soak.
export interface SoakBypass {
  version: string
  published: string
  removable: string
}

export interface NpmTool {
  description?: string | undefined
  integrity: string
  notes?: readonly string[] | undefined
  // `npm:<package-name>` — the registry-tarball marker isNpmTool keys on.
  repository: string
  soakBypass?: SoakBypass | undefined
  version: string
}

export interface PlatformEntry {
  asset: string
  integrity: string
}

export interface GithubReleaseTool {
  description?: string | undefined
  version: string
  repository: string
  release: 'asset' | string
  platforms: Record<string, PlatformEntry>
  soakBypass?: SoakBypass | undefined
}

export type Tool = NpmTool | GithubReleaseTool

export interface ExternalToolsJson {
  description?: string | undefined
  tools: Record<string, Tool>
}

export function isNpmTool(t: Tool): t is NpmTool {
  // npm-registry tools are marked `repository: "npm:<name>"` — ONE
  // platform-agnostic tarball, so no `platforms` map (that shape is the
  // github-release tools').
  const n = t as NpmTool
  return (
    typeof n.repository === 'string' &&
    n.repository.startsWith('npm:') &&
    typeof n.version === 'string'
  )
}

export function isGithubTool(t: Tool): t is GithubReleaseTool {
  // A real github-release tool carries BOTH a github repository AND a per-arch
  // `platforms` map. A `github:` repo with no platforms (an informational /
  // version-only pin that happens to name its upstream) is NOT bumpable this
  // way — without this platforms guard it routed to planGithubUpdate and crashed
  // on `Object.entries(undefined)`; now it falls through to the graceful skip.
  const g = t as GithubReleaseTool
  return (g.repository?.startsWith('github:') ?? false) && !!g.platforms
}

/**
 * Read the soak policy (`minimumReleaseAge` minutes + the
 * `minimumReleaseAgeExclude` bypass list) from a pnpm-workspace.yaml, via the
 * shared `soak-rules` reader so every soak surface decides identically. A tool
 * listed in `minimumReleaseAgeExclude` bypasses the soak here exactly as pnpm
 * bypasses it for npm installs — instead of only the `isSocketSourced` rule.
 */
export function readSoakPolicy(yamlPath: string): SoakRules {
  return readSoakRules(yamlPath)
}

/**
 * Fetch JSON via curl. Avoids a hard dependency on node:https + manual stream
 * handling — the script runs interactively, not on a hot path.
 */
export function curlJson<T>(
  url: string,
  extraHeaders: string[] = [],
): T | undefined {
  const headers = ['Accept: application/json', ...extraHeaders]
  const args: string[] = ['-fsSL']
  for (let i = 0, { length } = headers; i < length; i += 1) {
    const h = headers[i]!
    args.push('-H', h)
  }
  args.push(url)
  // GitHub's `?per_page=100` releases payload for an active repo (pnpm's is
  // ~2.5MB of release-note markdown) blows past Node's 1MB default maxBuffer,
  // which truncates stdout → JSON.parse fails → a silent `undefined` the caller
  // mistakes for "no newer release" (the pnpm-11.9 false-green). Lift it.
  const r = spawnSync('curl', args, { maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    return undefined
  }
  try {
    return JSON.parse(String(r.stdout)) as T
  } catch {
    return undefined
  }
}

/**
 * Fetch raw bytes via curl, return the SHA-512 hex digest. Used to verify a
 * GitHub release asset matches its declared SHA before we stamp the JSON.
 *
 * GitHub release assets can be hundreds of MB (sfw binaries are ~50MB). Bumping
 * `maxBuffer` to 256MB so a large asset isn't silently truncated — spawnSync
 * defaults to 1MB which is below most binaries.
 */
export function curlSha512(url: string): string | undefined {
  // The lib's SpawnSyncOptions types extend NodeSpawnOptions (async)
  // rather than NodeSpawnSyncOptions, so `encoding` and `maxBuffer`
  // aren't typed. The runtime accepts both. Cast through unknown.
  const r = spawnSync('curl', ['-fsSL', url], {
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
  } as unknown as Parameters<typeof spawnSync>[2])
  if (r.status !== 0 || !r.stdout) {
    return undefined
  }
  return crypto.createHash('sha512').update(r.stdout).digest('hex')
}

/**
 * Convert a SHA-512 hex digest to a Subresource Integrity (SRI) string —
 * `sha512-<base64>`. external-tools.json stores `integrity` in SRI form; the
 * setup action's installer reads that field for fetch-time verification.
 * sha512 is the fleet standard (every external-tools.json entry + npm's own
 * registry `dist.integrity`); install-tool.mjs parses the algo from the prefix.
 */
export function hexToSri(hex: string): string {
  return `sha512-${Buffer.from(hex, 'hex').toString('base64')}`
}

interface NpmVersionMeta {
  time: Record<string, string>
  versions: Record<
    string,
    { dist: { integrity?: string | undefined; tarball: string } }
  >
}

/**
 * Cheap preflight: resolve the `latest` dist-tag for an npm package. Used by
 * the npm-registry preflight in `planGithubUpdate` for tools whose npm version
 * line tracks the GitHub release line 1:1, pnpm today.
 *
 * Goes through `@socketsecurity/lib`'s `fetchPackageManifest` rather than a raw
 * curl so we get the fleet's standard packument cache, `.npmrc` auth handling,
 * and abort-signal plumbing for free. The call returns a single manifest (~few
 * KB) — _not_ the full packument — because pacote.manifest is what
 * fetchPackageManifest invokes under the hood. We read only `.version` off the
 * result.
 *
 * Does NOT apply the soak time. That's intentional: if npm `latest` is younger
 * than the soak, semver.lte against our current pin will say `latest <=
 * current`, we're already on the newest soaked version, and short-circuit
 * correctly. If `latest` is older than our pin we also short-circuit. The only
 * case the preflight lets through is `latest > current`, which then re-enters
 * the GitHub path where soak is enforced — so this is a strict superset of
 * "skip work".
 */
export async function fetchNpmLatestVersion(
  name: string,
): Promise<string | undefined> {
  const manifest = await fetchPackageManifest(`${name}@latest`)
  const version = (manifest as { version?: unknown | undefined } | undefined)
    ?.version
  return typeof version === 'string' ? version : undefined
}

/**
 * Fetch the npm-registry `dist.integrity` (sha512 SRI) for an EXACT version.
 * Used for a GitHub tool's npm-tarball asset — pnpm's darwin-x64 ships the
 * `pnpm-<version>.tgz` npm tarball (the SEA binary was dropped upstream), whose
 * integrity comes from the registry, not the GitHub release. Returns undefined
 * if the version or its integrity is missing.
 */
export async function fetchNpmVersionIntegrity(
  name: string,
  version: string,
): Promise<string | undefined> {
  const manifest = await fetchPackageManifest(`${name}@${version}`)
  const integrity = (
    manifest as
      | { dist?: { integrity?: unknown | undefined } | undefined }
      | undefined
  )?.dist?.integrity
  return typeof integrity === 'string' ? integrity : undefined
}

/**
 * Pick the HIGHEST-SEMVER npm version of `name` that has cleared the soak
 * window. Returns the version string, its integrity hash, and the registry's
 * publish timestamp for that version. `planNpmUpdate` dates a soak-bypass
 * annotation from that timestamp. Returns undefined when the registry has no
 * soak-cleared release at all, which is the case for a package published within
 * the window.
 *
 * Highest semver, NOT newest by publish date — the same rule
 * `pickNewestSoakedRelease` applies to GitHub releases. Maintainers ship
 * old-line patches after newer majors. Note: npm published 10.9.9 on
 * 2026-07-29, well after 12.0.1, so newest-by-date picks the back-line patch
 * and drives a MAJOR downgrade.
 */
export function pickNewestSoakedNpm(
  name: string,
  soakMinutes: number,
  soakExclude: readonly string[],
): { version: string; integrity: string; publishedAt: string } | undefined {
  const meta = curlJson<NpmVersionMeta>(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
  )
  if (!meta) {
    return undefined
  }
  // Bypass the soak window when the package is Socket-owned (trust model — see
  // pickNewestSoakedRelease) OR explicitly listed in the workspace's
  // `minimumReleaseAgeExclude`, so this tool follows the SAME bypass surface
  // pnpm honors for npm installs, one rule, read via soak-rules.
  const bypass =
    isSocketSourcedPackage(name) || isSoakExcluded(name, undefined, soakExclude)
  const cutoff = bypass ? Date.now() : Date.now() - soakMinutes * 60_000
  const candidates: Array<{
    version: string
    publishedAt: number
    publishedRaw: string
  }> = []
  for (const [version, when] of Object.entries(meta.time)) {
    if (version === 'created' || version === 'modified') {
      continue
    }
    const t = Date.parse(when)
    if (!Number.isFinite(t)) {
      continue
    }
    if (t > cutoff) {
      continue
    }
    // Skip prereleases for the npm case — fleet pins always reference
    // stable semver. (Prerelease support could be added behind a flag.)
    if (/-/.test(version)) {
      continue
    }
    candidates.push({ version, publishedAt: t, publishedRaw: when })
  }
  if (candidates.length === 0) {
    return undefined
  }
  const highest = maxVersion(candidates.map(c => c.version))
  const newest = candidates.find(c => c.version === highest)
  if (!newest) {
    return undefined
  }
  const versionMeta = meta.versions[newest.version]
  if (!versionMeta?.dist?.integrity) {
    return undefined
  }
  return {
    version: newest.version,
    integrity: versionMeta.dist.integrity,
    publishedAt: newest.publishedRaw,
  }
}

/**
 * Is `next` strictly newer than `current`? The updater only ever moves a pin
 * FORWARD — a proposal that is equal or lower is not an update.
 *
 * This is the invariant that stops two real downgrades the soak logic alone
 * cannot see: an old-line npm patch published after a newer major, and a pin
 * that deliberately rode a `soakBypass` ahead of the newest soak-cleared
 * release (zizmor 1.29.0 pinned while only 1.28.0 had cleared). Rolling either
 * back would violate the fleet's "a pin never moves down" rule. Leading `v` is
 * stripped so a `v`-prefixed GitHub tag compares against a bare pin.
 */
export function isForwardBump(current: string, next: string): boolean {
  // TOTAL, never throws: a pin or tag that is not clean semver (`kani-0.67.0`)
  // would make a bare `gt()` throw `Invalid Version` and abort that tool's plan.
  // Coerce both sides, and when either side cannot be coerced the direction is
  // unknowable — hold rather than risk writing a downgrade.
  const a = coerceVersion(current)
  const b = coerceVersion(next)
  if (!a || !b) {
    return false
  }
  return gt(b, a) === true
}

export interface ToolUpdate {
  name: string
  oldVersion: string
  newVersion: string
  changes: string[]
}

/**
 * Compute the update plan for one tool. Returns undefined when no change is
 * needed, already on the newest soak-cleared release.
 *
 * For GitHub-release-based tools, also re-downloads each platform-arch asset
 * and recomputes its integrity against the current declared value, surfacing a
 * warning if there's a mismatch, release-bytes drift.
 */
export function planNpmUpdate(
  name: string,
  tool: NpmTool,
  soakMinutes: number,
  soakExclude: readonly string[],
): ToolUpdate | undefined {
  const npmName = tool.repository.slice('npm:'.length)
  const current = tool.version
  // The tool's entry NAME and its npm package name can differ; check both
  // against the exclude list so either form bypasses the soak.
  const npmExclude = isSoakExcluded(name, undefined, soakExclude)
    ? [npmName, ...soakExclude]
    : soakExclude
  const next = pickNewestSoakedNpm(npmName, soakMinutes, npmExclude)
  // Forward-only: an equal or LOWER newest-soaked version is not an update. A
  // pin ahead of the newest soak-cleared release (one that rode a soakBypass)
  // must be left alone, never rolled back.
  if (!next || !isForwardBump(current, next.version)) {
    return undefined
  }
  const changes = [
    `version: ${current} → ${next.version} (npm:${npmName})`,
    `integrity: ${tool.integrity.slice(0, 24)}… → ${next.integrity.slice(0, 24)}…`,
  ]
  // Stamp / drop the inline soak-bypass, the same way planGithubUpdate does for
  // a release-distributed tool. Reaching here with a still-soaking version means
  // a bypass admitted it (`bump-tool --soak-bypass`, or a soakExclude entry), so
  // record the dated annotation the install-time soak check honors until
  // `removable` and `external-tools prune` drops once it clears; a version that
  // has already soaked drops any stale block. Mutating the tool in place matches
  // planGithubUpdate — the caller writes the manifest only under `--apply`.
  const soakBypass = computeSoakBypass({
    newVersion: next.version,
    nowMs: Date.now(),
    publishedAt: next.publishedAt,
    soakMinutes,
  })
  if (soakBypass) {
    tool.soakBypass = soakBypass
    changes.push(
      `soakBypass → ${next.version} (removable ${soakBypass.removable})`,
    )
  } else if (tool.soakBypass) {
    delete tool.soakBypass
    changes.push('soakBypass dropped (soak cleared)')
  }
  return {
    name,
    oldVersion: current,
    newVersion: next.version,
    changes,
  }
}

// One tool that could not be planned (asset fetch failed, release missing,
// integrity mismatch — the codedb case). Recorded instead of thrown so ONE
// tool's failure never aborts the whole sweep before the others are reached.
export interface ToolFailure {
  name: string
  error: string
}

export interface PlanAllResult {
  updates: ToolUpdate[]
  failures: ToolFailure[]
}

// All optional so a caller, a test, overrides only the planner it wants to
// stub — mirrors PlanGithubUpdateDeps. Defaults are the real planners.
export interface PlanAllDeps {
  planNpmUpdate?:
    | ((
        name: string,
        tool: NpmTool,
        soakMinutes: number,
        soakExclude: readonly string[],
      ) => ToolUpdate | undefined)
    | undefined
  planGithubUpdate?:
    | ((
        name: string,
        tool: GithubReleaseTool,
        soakMinutes: number,
        soakExclude: readonly string[],
        options?: { verifyAssets?: boolean | undefined } | undefined,
      ) => Promise<ToolUpdate | undefined>)
    | undefined
}

/**
 * Plan every tool's update with PER-TOOL ISOLATION. A single tool's planner
 * throwing (a failed asset fetch, a missing release, an integrity mismatch —
 * the codedb `linux-arm64` regression) is CAUGHT, recorded in `failures`, and
 * the sweep CONTINUES to the remaining tools. Never aborts the run before the
 * others are reached. The per-tool "refuse to write a stale integrity" safety
 * still lives in `planGithubUpdate`, it throws; here that throw only skips +
 * reports that one tool.
 *
 * GitHub tools are mutated in place on a successful bump (planGithubUpdate
 * rewrites `platforms`; this stamps `version`), exactly as the old inline loop
 * did — a failing tool threw before its final in-place assignment, so it keeps
 * its current valid pins.
 */
export async function planAllUpdates(
  tools: Record<string, Tool>,
  soakMinutes: number,
  soakExclude: readonly string[],
  options?: { verifyAssets?: boolean | undefined } | undefined,
  deps?: PlanAllDeps | undefined,
): Promise<PlanAllResult> {
  const { verifyAssets = false } = {
    __proto__: null,
    ...options,
  } as { verifyAssets?: boolean | undefined }
  const d = {
    __proto__: null,
    planNpmUpdate,
    planGithubUpdate,
    ...deps,
  } as {
    planNpmUpdate: NonNullable<PlanAllDeps['planNpmUpdate']>
    planGithubUpdate: NonNullable<PlanAllDeps['planGithubUpdate']>
  }
  const updates: ToolUpdate[] = []
  const failures: ToolFailure[] = []
  for (const [name, tool] of Object.entries(tools)) {
    try {
      let update: ToolUpdate | undefined
      if (isNpmTool(tool)) {
        update = d.planNpmUpdate(name, tool, soakMinutes, soakExclude)
      } else if (isGithubTool(tool)) {
        update = await d.planGithubUpdate(
          name,
          tool,
          soakMinutes,
          soakExclude,
          {
            verifyAssets,
          },
        )
        if (update && update.oldVersion !== update.newVersion) {
          // planGithubUpdate already rewrote tool.platforms in place; also
          // stamp the new version.
          tool.version = update.newVersion
        }
      } else {
        process.stdout.write(`  - ${name}: skipped (unknown tool shape)\n`)
        continue
      }
      if (update) {
        updates.push(update)
      }
    } catch (e) {
      // ISOLATE: record + continue. One tool's failure must never abort the
      // sweep (the codedb linux-arm64 asset-fetch abort). CI still notices via
      // the non-zero exit the caller derives from a non-empty failures list.
      const error = errorMessage(e)
      failures.push({ name, error })
      process.stdout.write(`  - ${name}: FAILED — ${error}\n`)
    }
  }
  return { updates, failures }
}

/**
 * Re-stamp each npm tool named in `updates` with its newest soak-cleared
 * version + integrity. planNpmUpdate stamps only the `soakBypass` block, so
 * the version + integrity pair is re-derived here. Shared by the bulk
 * updater's apply step and the CRUD tool's `update` subcommand so the restamp
 * logic lives in one place.
 */
export function applyNpmRestamp(
  json: ExternalToolsJson,
  updates: readonly ToolUpdate[],
  soakMinutes: number,
  soakExclude: readonly string[],
): void {
  for (let i = 0, { length } = updates; i < length; i += 1) {
    const tool = json.tools[updates[i]!.name]
    if (!tool || !isNpmTool(tool)) {
      continue
    }
    const npmName = tool.repository.slice('npm:'.length)
    const next = pickNewestSoakedNpm(npmName, soakMinutes, soakExclude)
    if (!next) {
      continue
    }
    tool.version = next.version
    tool.integrity = next.integrity
  }
}

// Every member is resolved by parseArgs, so this is a required `config` rather
// than an optional options bag.
export interface UpdateCliConfig {
  apply: boolean
  // Absolute manifest paths to sweep. Defaults to every shipped
  // external-tools.json; `--target <file>` narrows it to one.
  targets: string[]
  verifyAssets: boolean
}

/**
 * Parse the updater's flags. `--target` names a manifest FILE, the same
 * contract every sibling verb uses — the soak policy is read from the repo's
 * own `pnpm-workspace.yaml`, so a manifest no longer has to sit beside one. The
 * previous directory-based contract made
 * `scripts/fleet/setup/external-tools.json` unreachable (no
 * `pnpm-workspace.yaml` in that directory), which is how `fff` sat at a version
 * two releases behind its newest soak-cleared release.
 */
export function parseArgs(
  argv: readonly string[] = process.argv.slice(2),
): UpdateCliConfig {
  let apply = false
  let target: string | undefined
  let verifyAssets = false
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const a = argv[i]!
    if (a === '--apply') {
      apply = true
    } else if (a === '--verify-assets') {
      verifyAssets = true
    } else if (a === '--target') {
      target = requireValue(argv as string[], i, '--target')
      i += 1
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  return { apply, targets: resolveTargets({ target }), verifyAssets }
}

export interface ManifestSweepResult {
  failures: ToolFailure[]
  updates: ToolUpdate[]
}

/**
 * Plan (and under `--apply`, write) one manifest. Returns the manifest's
 * updates + isolated failures so the caller can aggregate across every manifest
 * and derive one exit code.
 */
export async function sweepManifest(
  manifestPath: string,
  soakMinutes: number,
  soakExclude: readonly string[],
  options?:
    | { apply?: boolean | undefined; verifyAssets?: boolean | undefined }
    | undefined,
): Promise<ManifestSweepResult> {
  const { apply = false, verifyAssets = false } = {
    __proto__: null,
    ...options,
  } as { apply?: boolean | undefined; verifyAssets?: boolean | undefined }
  let json: ExternalToolsJson
  try {
    json = JSON.parse(readFileSync(manifestPath, 'utf8')) as ExternalToolsJson
  } catch (e) {
    // Manifest validity is `check-external-tools-are-valid`'s gate; an
    // unreadable file here is reported as this manifest's failure, never a
    // silent skip and never an abort of the remaining manifests.
    return {
      failures: [{ name: relPath(manifestPath), error: errorMessage(e) }],
      updates: [],
    }
  }
  process.stdout.write(`\n--- ${relPath(manifestPath)}\n`)
  // Per-tool-isolated planning: one tool's throw (a failed asset fetch) is
  // caught + recorded, the rest still get planned.
  const { failures, updates } = await planAllUpdates(
    json.tools,
    soakMinutes,
    soakExclude,
    { verifyAssets },
  )
  if (updates.length === 0) {
    process.stdout.write('  All tools current.\n')
  } else {
    process.stdout.write(`  Proposed updates (${updates.length}):\n`)
    for (let i = 0, { length } = updates; i < length; i += 1) {
      const u = updates[i]!
      process.stdout.write(`\n  ${u.name}:\n`)
      for (const c of u.changes) {
        process.stdout.write(`    - ${c}\n`)
      }
    }
  }
  if (apply && updates.length > 0) {
    // Re-stamp npm-tool version + integrity in place (planNpmUpdate stamps
    // only the soakBypass block). GitHub tools were already rewritten by
    // planAllUpdates. A failed tool threw before mutating, so its entry keeps
    // its current valid pins and is written back unchanged.
    applyNpmRestamp(json, updates, soakMinutes, soakExclude)
    writeThroughMirrorLock(manifestPath, JSON.stringify(json, null, 2) + '\n')
    process.stdout.write(`  Wrote ${relPath(manifestPath)}\n`)
  }
  return { failures, updates }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const opts = parseArgs(argv)
  // ONE soak policy for the whole sweep, read from the repo's own workspace file
  // rather than a sibling of each manifest.
  const { exclude: soakExclude, minutes: soakMinutes } =
    readSoakPolicy(PNPM_WORKSPACE_YAML)
  process.stdout.write(
    `Soak time: ${soakMinutes} minutes (${(soakMinutes / 60 / 24).toFixed(1)} days)\n`,
  )
  if (opts.targets.length === 0) {
    process.stdout.write('No external-tools.json manifests found.\n')
    return 1
  }
  process.stdout.write(`Manifests: ${opts.targets.length}\n`)
  const failures: ToolFailure[] = []
  let updateCount = 0
  for (let i = 0, { length } = opts.targets; i < length; i += 1) {
    const result = await sweepManifest(
      opts.targets[i]!,
      soakMinutes,
      soakExclude,
      { apply: opts.apply, verifyAssets: opts.verifyAssets },
    )
    updateCount += result.updates.length
    failures.push(...result.failures)
  }
  if (opts.apply && updateCount > 0) {
    // external-tools.json is the single source for the pnpm/npm version pins —
    // propagate the new versions to package.json (devEngines + engines) so they
    // are never hand-maintained. Runs once, at the repo root, after every
    // manifest has been written.
    const syncResult = spawnSync(
      'node',
      ['scripts/fleet/sync-package-manager-pins.mts'],
      { cwd: REPO_ROOT, stdio: 'inherit' },
    )
    if (syncResult.status !== 0) {
      process.stdout.write(
        'Warning: package-manager pin sync did not complete cleanly — run `node scripts/fleet/sync-package-manager-pins.mts`.\n',
      )
    }
  } else if (!opts.apply && updateCount > 0) {
    process.stdout.write(`\nDry run. Pass --apply to write changes.\n`)
  }
  // Summarize the isolated failures + exit non-zero so CI still notices, WITHOUT
  // aborting before the healthy tools were planned/written above.
  if (failures.length > 0) {
    process.stdout.write(
      `\n${failures.length} tool(s) FAILED (the rest were still processed):\n`,
    )
    for (let i = 0, { length } = failures; i < length; i += 1) {
      const f = failures[i]!
      process.stdout.write(`  - ${f.name}: ${f.error}\n`)
    }
    return 1
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'bump external-tools.json entries to their newest soak-cleared release',
  help: `Usage: node scripts/fleet/external-tools/update.mts [flags]
  --apply          write the planned changes (default is a dry run)
  --verify-assets  re-download each asset to surface SHA drift on the current pin (slower)
  --target <file>  limit the sweep to one manifest file (default: every shipped manifest)`,
}

// Only invoke main() when run directly, not when imported by the vitest specs.
// Without this guard, an import would walk every external-tools.json + hit the
// network during the test process.
if (import.meta.main) {
  runMain(main, SCRIPT_META)
}
