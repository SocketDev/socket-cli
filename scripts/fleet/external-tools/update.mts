/* max-file-lines: orchestration — soak-clear → fetch-latest → rewrite pipeline for both tool entry shapes; the phases share the soak-policy + entry-shape state. */
/**
 * @file Bump external-tools.json entries to their latest soak- cleared release.
 *   "Soak-cleared" = published more than `minimumReleaseAge` minutes ago, where
 *   `minimumReleaseAge` is read from `pnpm-workspace.yaml`. Mirrors the soak
 *   time pnpm uses for npm catalog entries — same policy, different
 *   distribution channel (npm vs GitHub releases vs npm tarball integrity
 *   hash). Two entry shapes:
 *
 *   1. npm-based (purl + integrity) { purl: 'pkg:npm/ecc-agentshield@1.4.0',
 *      integrity: 'sha512-...' } → query npm registry, pick newest published >=
 *      soak time ago, → rewrite purl version + integrity.
 *   2. github-release-based (repository + version + platforms per platform-arch).
 *      The `repository: 'github:owner/repo'` shape → query GitHub releases API,
 *      pick newest published >= soak time ago, → rewrite version + platforms
 *      (URL implicit from `${repo}/releases/download/${version}/${asset}`,
 *      integrity recomputed from the asset bytes as an SRI `sha512-<base64>`
 *      string). Default mode is dry-run: prints the proposed diff but doesn't
 *      write. `--apply` flushes changes. Idempotent — re-running on an already-
 *      up-to-date file is a no-op. Reads soak time from wheelhouse's own
 *      pnpm-workspace.yaml. Other repos that have their own external-tools.json
 *      (via the setup-security-tools cascade) inherit the same window because
 *      the file is byte-cascaded; running this script against a downstream repo
 *      would use that repo's pnpm-workspace.yaml soak time. Invoked as: node
 *      scripts/update-external-tools.mts [--apply] [--target <path>] Where
 *      <path> is a directory containing an external-tools.json + a
 *      pnpm-workspace.yaml. Defaults to the wheelhouse template's
 *      setup-security-tools/external-tools.json + the wheelhouse's
 *      pnpm-workspace.yaml.
 */

import crypto from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Fleet convention (socket/prefer-async-spawn): use the lib's
// spawnSync, not node:child_process. Drop `encoding:` from options —
// the lib's `stdioString: true` default already returns strings.
// oxlint-disable-next-line socket/prefer-async-spawn -- audit/cascade script needs sync stdin/stdout + typed string return; v5 lib spawnSync omits 'encoding' from SpawnSyncOptions and returns string-or-Buffer. v6 lib (when published) will obviate this.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { fetchPackageManifest } from '@socketsecurity/lib/packages/manifest'

import { isSocketSourcedPackage } from '../constants/socket-scopes.mts'
import { planGithubUpdate } from './github.mts'

import { REPO_ROOT } from '../paths.mts'
import { isSoakExcluded, readSoakRules } from '../soak-rules.mts'
import type { SoakRules } from '../soak-rules.mts'

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
  purl: string
  integrity: string
  soakBypass?: SoakBypass | undefined
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
  return (t as NpmTool).purl !== undefined
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
function readSoakPolicy(yamlPath: string): SoakRules {
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
 * line tracks the GitHub release line 1:1 (pnpm today).
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
 * current` (we're already on the newest soaked version) and short-circuit
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
 * Pick the newest npm version of `name` that's older than the soak window.
 * Returns the version string + integrity hash, or undefined if the registry has
 * no soak-cleared release (very new package).
 */
export function pickNewestSoakedNpm(
  name: string,
  soakMinutes: number,
  soakExclude: readonly string[],
): { version: string; integrity: string } | undefined {
  const meta = curlJson<NpmVersionMeta>(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
  )
  if (!meta) {
    return undefined
  }
  // Bypass the soak window when the package is Socket-owned (trust model — see
  // pickNewestSoakedRelease) OR explicitly listed in the workspace's
  // `minimumReleaseAgeExclude`, so this tool follows the SAME bypass surface
  // pnpm honors for npm installs (one rule, read via soak-rules).
  const bypass =
    isSocketSourcedPackage(name) || isSoakExcluded(name, undefined, soakExclude)
  const cutoff = bypass ? Date.now() : Date.now() - soakMinutes * 60_000
  const candidates: Array<{ version: string; publishedAt: number }> = []
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
    candidates.push({ version, publishedAt: t })
  }
  if (candidates.length === 0) {
    return undefined
  }
  candidates.sort((a, b) => b.publishedAt - a.publishedAt)
  const newest = candidates[0]!
  const versionMeta = meta.versions[newest.version]
  if (!versionMeta?.dist?.integrity) {
    return undefined
  }
  return {
    version: newest.version,
    integrity: versionMeta.dist.integrity,
  }
}

export interface ToolUpdate {
  name: string
  oldVersion: string
  newVersion: string
  changes: string[]
}

/**
 * Compute the update plan for one tool. Returns undefined when no change is
 * needed (already on the newest soak-cleared release).
 *
 * For GitHub-release-based tools, also re-downloads each platform-arch asset
 * and recomputes its integrity against the current declared value, surfacing a
 * warning if there's a mismatch (release-bytes drift).
 */
export function planNpmUpdate(
  name: string,
  tool: NpmTool,
  soakMinutes: number,
  soakExclude: readonly string[],
): ToolUpdate | undefined {
  // Parse current version out of the purl.
  const m = /^pkg:npm\/([^@]+)@(.+)$/.exec(tool.purl)
  if (!m) {
    return undefined
  }
  const npmName = decodeURIComponent(m[1]!)
  const current = m[2]!
  // The tool's entry NAME and its npm package name can differ; check both
  // against the exclude list so either form bypasses the soak.
  const npmExclude = isSoakExcluded(name, undefined, soakExclude)
    ? [npmName, ...soakExclude]
    : soakExclude
  const next = pickNewestSoakedNpm(npmName, soakMinutes, npmExclude)
  if (!next || next.version === current) {
    return undefined
  }
  return {
    name,
    oldVersion: current,
    newVersion: next.version,
    changes: [
      `purl: pkg:npm/${npmName}@${current} → pkg:npm/${npmName}@${next.version}`,
      `integrity: ${tool.integrity.slice(0, 24)}… → ${next.integrity.slice(0, 24)}…`,
    ],
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

// All optional so a caller (a test) overrides only the planner it wants to
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
 * still lives in `planGithubUpdate` (it throws); here that throw only skips +
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
      const error = e instanceof Error ? e.message : String(e)
      failures.push({ name, error })
      process.stdout.write(`  - ${name}: FAILED — ${error}\n`)
    }
  }
  return { updates, failures }
}

/**
 * Re-stamp each npm tool named in `updates` with its newest soak-cleared purl +
 * integrity. planNpmUpdate is non-mutating (it only computes the diff), so the
 * write path re-derives here. Shared by the bulk updater's apply step and the
 * CRUD tool's `update` subcommand so the restamp logic lives in one place.
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
    const m = /^pkg:npm\/([^@]+)@/.exec(tool.purl)
    if (!m) {
      continue
    }
    const npmName = decodeURIComponent(m[1]!)
    const next = pickNewestSoakedNpm(npmName, soakMinutes, soakExclude)
    if (!next) {
      continue
    }
    tool.purl = `pkg:npm/${npmName}@${next.version}`
    tool.integrity = next.integrity
  }
}

interface CliOpts {
  apply: boolean
  externalToolsPath: string
  pnpmWorkspaceYaml: string
  verifyAssets: boolean
}

function parseArgs(): CliOpts {
  let apply = false
  let externalToolsPath = path.join(
    REPO_ROOT,
    'template/base/.claude/hooks/fleet/setup-security-tools/external-tools.json',
  )
  let pnpmWorkspaceYaml = path.join(REPO_ROOT, 'pnpm-workspace.yaml')
  let verifyAssets = false
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!
    if (a === '--apply') {
      apply = true
    } else if (a === '--verify-assets') {
      verifyAssets = true
    } else if (a === '--target') {
      const next = argv[i + 1]
      if (!next) {
        throw new Error('--target requires a directory path')
      }
      externalToolsPath = path.join(next, 'external-tools.json')
      pnpmWorkspaceYaml = path.join(next, 'pnpm-workspace.yaml')
      i += 1
    } else if (a === '--help') {
      process.stdout.write(
        'Usage: node scripts/update-external-tools.mts ' +
          '[--apply] [--verify-assets] [--target <dir>]\n' +
          '\n' +
          'Default dry-run prints the planned changes. --apply flushes.\n' +
          '--verify-assets re-downloads each asset to surface SHA drift on\n' +
          'the *current* pinned version (slower; ~10s per asset).\n',
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  return { apply, externalToolsPath, pnpmWorkspaceYaml, verifyAssets }
}

async function main(): Promise<number> {
  const opts = parseArgs()
  const { exclude: soakExclude, minutes: soakMinutes } = readSoakPolicy(
    opts.pnpmWorkspaceYaml,
  )
  process.stdout.write(
    `Soak time: ${soakMinutes} minutes (${(soakMinutes / 60 / 24).toFixed(1)} days)\n`,
  )
  process.stdout.write(`External-tools file: ${opts.externalToolsPath}\n`)
  const json = JSON.parse(
    readFileSync(opts.externalToolsPath, 'utf8'),
  ) as ExternalToolsJson
  // Per-tool-isolated planning: one tool's throw (the codedb asset-fetch abort)
  // is caught + recorded, the rest still get planned.
  const { failures, updates } = await planAllUpdates(
    json.tools,
    soakMinutes,
    soakExclude,
    { verifyAssets: opts.verifyAssets },
  )
  if (updates.length === 0) {
    process.stdout.write('All tools current.\n')
  } else {
    process.stdout.write(`\nProposed updates (${updates.length}):\n`)
    for (let i = 0, { length } = updates; i < length; i += 1) {
      const u = updates[i]!
      process.stdout.write(`\n  ${u.name}:\n`)
      for (const c of u.changes) {
        process.stdout.write(`    - ${c}\n`)
      }
    }
  }
  if (opts.apply && updates.length > 0) {
    // Re-stamp npm-tool purl + integrity in place (planNpmUpdate doesn't
    // mutate the tool object). GitHub tools were already rewritten by
    // planAllUpdates. A failed tool threw before mutating, so its entry keeps
    // its current valid pins and is written back unchanged.
    applyNpmRestamp(json, updates, soakMinutes, soakExclude)
    writeFileSync(opts.externalToolsPath, JSON.stringify(json, null, 2) + '\n')
    process.stdout.write(`\nWrote ${opts.externalToolsPath}\n`)
    // external-tools.json is the single source for the pnpm/npm version pins —
    // propagate the new versions to the target repo's package.json
    // (packageManager + engines) so they are never hand-maintained. Runs in the
    // target root so a cross-repo bump syncs that repo's package.json.
    const targetRoot = path.resolve(
      path.dirname(opts.externalToolsPath),
      '../../..',
    )
    const syncResult = spawnSync(
      'node',
      ['scripts/fleet/sync-package-manager-pins.mts'],
      { cwd: targetRoot, stdio: 'inherit' },
    )
    if (syncResult.status !== 0) {
      process.stdout.write(
        'Warning: package-manager pin sync did not complete cleanly — run `node scripts/fleet/sync-package-manager-pins.mts`.\n',
      )
    }
  } else if (!opts.apply && updates.length > 0) {
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

// Only invoke main() when run directly (e.g. `node update-external-tools.mts`),
// not when imported by the vitest test that exercises `shouldSkipGithubFetch`.
// Without this guard, an import would walk external-tools.json + hit the
// network during the test process.
if (import.meta.main) {
  main().then(
    code => {
      process.exitCode = code
    },
    err => {
      process.stderr.write(
        `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      )
      process.exitCode = 1
    },
  )
}
