/**
 * @file GitHub-release path of the external-tools updater: fetch the newest
 *   soak-cleared GitHub release for a tool, run the pnpm npm-preflight skip
 *   optimization, and plan the version + per-platform-integrity rewrite. Split
 *   out of `update-external-tools.mts` so the npm path + orchestration stay in
 *   the main file; the leaf network/SRI helpers (curlJson / curlSha512 /
 *   hexToSri / fetchNpmLatestVersion) and shared types are imported from it
 *   (function-import cycle; nothing runs at module load, so ESM resolves it).
 */

import { compare } from '@socketsecurity/lib-stable/versions/compare'
import {
  coerceVersion,
  isValidVersion,
} from '@socketsecurity/lib-stable/versions/parse'

import { isSocketSourcedRepository } from '../constants/socket-scopes.mts'
import {
  curlJson,
  curlSha512,
  fetchNpmLatestVersion,
  fetchNpmVersionIntegrity,
  hexToSri,
} from './update.mts'
import type {
  GithubReleaseTool,
  PlatformEntry,
  SoakBypass,
  ToolUpdate,
} from './update.mts'

import { isSoakExcluded } from '../soak-rules.mts'

/**
 * Build the inline soak-bypass annotation for a release adopted while still
 * inside the soak window, or `undefined` once it has cleared (so a stale bypass
 * is dropped). Pure — the caller supplies the release date, soak window, and
 * clock. Dates are `YYYY-MM-DD` (what the install-time soak check +
 * soak-pin-needs-annotation expect).
 */
export function computeSoakBypass(config: {
  newVersion: string
  nowMs: number
  publishedAt: string
  soakMinutes: number
}): SoakBypass | undefined {
  const cfg = { __proto__: null, ...config } as typeof config
  const publishedMs = Date.parse(cfg.publishedAt)
  if (!Number.isFinite(publishedMs)) {
    return undefined
  }
  const soakMs = cfg.soakMinutes * 60_000
  // Cleared the soak → no bypass needed.
  if (publishedMs <= cfg.nowMs - soakMs) {
    return undefined
  }
  const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
  return {
    published: isoDay(publishedMs),
    removable: isoDay(publishedMs + soakMs),
    version: cfg.newVersion,
  }
}

export interface GithubRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  published_at: string
  assets: Array<{
    name: string
    browser_download_url: string
  }>
}

export interface PickNewestSoakedReleaseDeps {
  curlJson: <T>(
    url: string,
    extraHeaders?: string[] | undefined,
  ) => T | undefined
}

/**
 * Pick the HIGHEST-SEMVER GitHub release for `owner/repo` that has cleared the
 * soak window (`published_at` older than the soak time, unless bypassed). Skips
 * drafts, prereleases, and non-semver tags. Highest-semver — NOT newest by
 * publish date — so an old-line LTS patch published after a newer major never
 * shadows it (which would drive a major downgrade the caller then refuses).
 */
export function pickNewestSoakedRelease(
  repository: string,
  soakMinutes: number,
  soakExclude: readonly string[],
  toolName: string,
  deps?: PickNewestSoakedReleaseDeps | undefined,
): GithubRelease | undefined {
  const opts = {
    __proto__: null,
    curlJson,
    ...deps,
  } as Required<PickNewestSoakedReleaseDeps>
  // `repository` shape is `github:owner/repo`.
  const slug = repository.startsWith('github:')
    ? repository.slice('github:'.length)
    : repository
  // GitHub returns up to 100 releases per page; that's enough for
  // every fleet tool we currently track (zizmor / sfw / etc release
  // weekly at most).
  const url = `https://api.github.com/repos/${slug}/releases?per_page=100`
  // Use the GITHUB_TOKEN env var when present to lift the unauth rate
  // limit from 60 to 5000 req/hour.
  const extra: string[] = [
    'User-Agent: socket-wheelhouse-update-external-tools',
  ]
  if (process.env['GITHUB_TOKEN']) {
    extra.push(`Authorization: token ${process.env['GITHUB_TOKEN']}`)
  }
  const releases = opts.curlJson<GithubRelease[]>(url, extra)
  if (!releases) {
    // A successful fetch returns a JSON array (possibly empty); `undefined`
    // means curl errored or the body didn't parse. FAIL LOUD — never treat a
    // fetch failure as "no newer release", which silently reports "already
    // current" and skips the bump (the pnpm-11.9 false-green this repo's
    // code-first-then-ai rule exists to stop).
    throw new Error(
      `Failed to fetch GitHub releases for ${slug}.\n` +
        `  Where: GET ${url}\n` +
        `  Saw:   curl failed or returned non-JSON (network, rate limit, or an oversized response).\n` +
        `  Fix:   retry (optionally export GITHUB_TOKEN to lift the 60/hr unauth limit). This is a FETCH FAILURE, not "no newer release".`,
    )
  }
  // Bypass the soak window when the repo is Socket-owned (internal repos like
  // SocketDev/sfw-free go through Socket's own provenance pipeline; the 7-day
  // soak there just makes fleet adoption lag our publish cadence) OR the tool's
  // entry name is in the workspace's `minimumReleaseAgeExclude` — the SAME
  // bypass surface pnpm honors, read via soak-rules. Socket-repo source of
  // truth: scripts/constants/socket-scopes.mts SOCKET_GITHUB_ORGS.
  const bypass =
    isSocketSourcedRepository(repository) ||
    isSoakExcluded(toolName, undefined, soakExclude)
  const cutoff = bypass ? Date.now() : Date.now() - soakMinutes * 60_000
  const cleared = releases.filter(r => {
    if (r.draft || r.prerelease || !coerceVersion(r.tag_name)) {
      return false
    }
    const t = Date.parse(r.published_at)
    return Number.isFinite(t) && t <= cutoff
  })
  if (cleared.length === 0) {
    return undefined
  }
  // Highest SEMVER wins, NOT newest by publish date: a maintainer may ship an
  // old-line LTS patch (e.g. pnpm 10.34.5) AFTER a newer major (11.11.0), and
  // newest-by-date would pick the patch — a major downgrade the caller refuses.
  // Tags are `vX.Y.Z`; coerce (non-null after the filter above) + compare(b,a)
  // for descending order.
  cleared.sort(
    (a, b) =>
      compare(coerceVersion(b.tag_name)!, coerceVersion(a.tag_name)!) ?? 0,
  )
  return cleared[0]
}

export function shouldSkipGithubFetch(
  npmLatest: string | undefined,
  current: string,
): boolean {
  if (!npmLatest) {
    return false
  }
  if (!isValidVersion(npmLatest)) {
    return false
  }
  if (!isValidVersion(current)) {
    return false
  }
  // compare() returns -1 / 0 / 1 for older / equal / newer. Skip when
  // npm latest is older or equal — nothing newer can exist on GitHub
  // for the line we track 1:1.
  return (compare(npmLatest, current) ?? 0) <= 0
}

export interface PlanGithubUpdateOptions {
  // When true, download + checksum-verify every platform asset before
  // proposing the bump (slower; off by default for the cheap-check path).
  verifyAssets?: boolean | undefined
}

// All fields optional: planGithubUpdate spreads these over real-function
// defaults and casts the result to Required, so a caller (a test) overrides
// only the deps it cares about.
export interface PlanGithubUpdateDeps {
  fetchNpmLatestVersion?:
    | ((name: string) => Promise<string | undefined>)
    | undefined
  fetchNpmVersionIntegrity?:
    | ((name: string, version: string) => Promise<string | undefined>)
    | undefined
  pickNewestSoakedRelease?:
    | ((
        repository: string,
        soakMinutes: number,
        soakExclude: readonly string[],
        toolName: string,
      ) => GithubRelease | undefined)
    | undefined
  curlSha512?: ((url: string) => string | undefined) | undefined
  hexToSri?: ((hex: string) => string) | undefined
}

export async function planGithubUpdate(
  name: string,
  tool: GithubReleaseTool,
  soakMinutes: number,
  soakExclude: readonly string[],
  options?: PlanGithubUpdateOptions | undefined,
  deps?: PlanGithubUpdateDeps | undefined,
): Promise<ToolUpdate | undefined> {
  const { verifyAssets = false } = {
    __proto__: null,
    ...options,
  } as PlanGithubUpdateOptions
  const d = {
    __proto__: null,
    fetchNpmLatestVersion,
    fetchNpmVersionIntegrity,
    pickNewestSoakedRelease,
    curlSha512,
    hexToSri,
    ...deps,
  } as {
    [K in keyof PlanGithubUpdateDeps]-?: NonNullable<PlanGithubUpdateDeps[K]>
  }
  const current = tool.version

  // npm-registry preflight optimization — pnpm only.
  //
  // pnpm@x.y.z on npm tracks pnpm/pnpm@x.y.z on GitHub 1:1, so checking
  // the npm `latest` tag is a cheap way to skip the GitHub releases
  // API call + 7+ per-platform asset downloads when no bump is
  // available. The check is safe-by-construction: if npm `latest` is
  // <= our current pin, no newer GitHub tag can exist either.
  //
  // Hardcoded to `name === 'pnpm'` (not opt-in via a config field):
  //   - sfw publishes to npm too but the npm version line (`sfw@2.x`)
  //     does NOT track the GitHub release line (`SocketDev/sfw-free@
  //     1.7.x`) — applying the preflight would silently mis-report.
  //   - zizmor isn't on npm at all.
  //   - Generalizing requires per-tool knowledge of release-line
  //     parity, which is information the operator already has via
  //     this file. Adding it as a config field would just push the
  //     same decision to JSON; keeping the gate keyed on the well-
  //     known tool name keeps the JSON simpler.
  //
  // --verify-assets bypasses the preflight: that flag exists to
  // recheck the live asset bytes even when versions are unchanged
  // (release-bytes drift), and the preflight would short-circuit
  // that intent.
  //
  // Soak-bypass carve-out: the safe-by-construction claim above ("npm latest
  // <= current → no newer GitHub tag") holds only once npm `latest` has caught
  // up to the GitHub release. For a FRESH release that lag can be hours — and a
  // soak-bypass (`bump-tool --soak-bypass`, which adds the tool to soakExclude)
  // exists precisely to grab a release inside its soak window, where the lag is
  // live. Letting the preflight short-circuit there silently reports "already
  // current" and defeats the bypass — the pnpm-11.9 gap. So skip the preflight
  // when the tool is soak-excluded; the GitHub releases list is authoritative.
  if (
    name === 'pnpm' &&
    !verifyAssets &&
    !isSoakExcluded(name, undefined, soakExclude)
  ) {
    const npmLatest = await d.fetchNpmLatestVersion('pnpm')
    if (shouldSkipGithubFetch(npmLatest, current)) {
      return undefined
    }
  }

  const newest = d.pickNewestSoakedRelease(
    tool.repository,
    soakMinutes,
    soakExclude,
    name,
  )
  if (!newest) {
    return undefined
  }
  // Match the existing version field's format: pnpm pins are unprefixed
  // ("11.8.0") while its GitHub tags carry a leading "v" (v11.9.0) — strip to
  // match. A tool whose version field already carries "v" keeps it. The raw
  // `tag` is always used for GitHub download URLs.
  const tag = newest.tag_name
  const newVersion = current.startsWith('v') ? tag : tag.replace(/^v/, '')
  const slug = tool.repository.slice('github:'.length)
  // npm-tarball asset shape: pnpm's darwin-x64 ships `pnpm-<version>.tgz` (the
  // SEA binary was dropped upstream), whose name embeds the version and whose
  // integrity comes from the npm registry — NOT the GitHub release. This is the
  // github-release-vs-npm gap that forced pnpm hand-bumps.
  const npmTarballAsset = `${name}-${current}.tgz`
  if (newVersion === current) {
    if (!verifyAssets) {
      return undefined
    }
    // Recheck asset integrity against the live release — surfaces
    // release-bytes drift even when the version is unchanged.
    const changes: string[] = []
    for (const [arch, entry] of Object.entries(tool.platforms)) {
      if (entry.asset === npmTarballAsset) {
        const liveIntegrity = await d.fetchNpmVersionIntegrity(name, current)
        if (liveIntegrity && liveIntegrity !== entry.integrity) {
          changes.push(
            `${arch} (npm) integrity drift: ${entry.integrity} → ${liveIntegrity}`,
          )
        }
        continue
      }
      const assetUrl = `https://github.com/${slug}/releases/download/${tag}/${entry.asset}`
      const liveHex = d.curlSha512(assetUrl)
      if (!liveHex) {
        continue
      }
      const liveIntegrity = d.hexToSri(liveHex)
      if (liveIntegrity !== entry.integrity) {
        changes.push(
          `${arch} integrity drift: ${entry.integrity} → ${liveIntegrity}`,
        )
      }
    }
    if (changes.length === 0) {
      return undefined
    }
    return { name, oldVersion: current, newVersion: current, changes }
  }
  // New release — recompute every asset's integrity against the new tag.
  const changes: string[] = [`version: ${current} → ${newVersion}`]
  const newPlatforms: Record<string, PlatformEntry> = {}
  for (const [arch, entry] of Object.entries(tool.platforms)) {
    // npm-tarball asset: rename to the new version + fetch the npm SRI.
    if (entry.asset === npmTarballAsset) {
      const newAsset = `${name}-${newVersion}.tgz`
      const integrity = await d.fetchNpmVersionIntegrity(name, newVersion)
      if (!integrity) {
        changes.push(
          `${arch}: FAILED to fetch npm integrity for ${name}@${newVersion} — keeping old`,
        )
        newPlatforms[arch] = entry
        continue
      }
      newPlatforms[arch] = { asset: newAsset, integrity }
      if (integrity !== entry.integrity) {
        changes.push(
          `${arch} (npm) integrity: ${entry.integrity.slice(0, 18)}… → ${integrity.slice(0, 18)}…`,
        )
      }
      continue
    }
    // Regenerate a version-embedded asset name (trufflehog_3.93.8_… ->
    // trufflehog_3.95.7_…) so the fetch targets the NEW release's asset. Assets
    // that don't embed the version (sfw, uv, zizmor, cdxgen) are left unchanged.
    const curBare = current.replace(/^v/, '')
    const newBare = newVersion.replace(/^v/, '')
    const newAsset =
      curBare && entry.asset.includes(curBare)
        ? entry.asset.split(curBare).join(newBare)
        : entry.asset
    const assetUrl = `https://github.com/${slug}/releases/download/${tag}/${newAsset}`
    const sha = d.curlSha512(assetUrl)
    if (!sha) {
      // Fail LOUD, never false-green: a version bump whose asset can't be
      // fetched must NOT write a version+stale-integrity mismatch (the previous
      // behavior — keep old integrity, bump version — shipped a broken pin).
      // Abort the whole bump; the file keeps its current valid pins.
      throw new Error(
        `${name}: ${arch} asset fetch failed for "${newAsset}" at ${tag}. ` +
          `Refusing to write a ${current} → ${newVersion} bump with a stale ` +
          `integrity. Fix: confirm the release + asset-name pattern, then retry.`,
      )
    }
    const integrity = d.hexToSri(sha)
    newPlatforms[arch] = { asset: newAsset, integrity }
    if (newAsset !== entry.asset) {
      changes.push(`${arch} asset: ${entry.asset} → ${newAsset}`)
    }
    if (integrity !== entry.integrity) {
      changes.push(
        `${arch} integrity: ${entry.integrity.slice(0, 18)}… → ${integrity.slice(0, 18)}…`,
      )
    }
  }
  // Stamp / drop the inline soak-bypass. Reaching here with a soaking release
  // means a bypass admitted it (pickNewestSoakedRelease excludes soaking
  // releases otherwise), so record the annotation the install-time soak check
  // honors until `removable`; a cleared release drops any stale bypass.
  const soakBypass = computeSoakBypass({
    newVersion,
    nowMs: Date.now(),
    publishedAt: newest.published_at,
    soakMinutes,
  })
  if (soakBypass) {
    ;(tool as GithubReleaseTool).soakBypass = soakBypass
    changes.push(
      `soakBypass → ${newVersion} (removable ${soakBypass.removable})`,
    )
  } else if ((tool as GithubReleaseTool).soakBypass) {
    delete (tool as GithubReleaseTool).soakBypass
    changes.push('soakBypass dropped (soak cleared)')
  }
  // Stash the new platforms on the tool in place so applyUpdates can
  // write them back.
  ;(tool as GithubReleaseTool).platforms = newPlatforms
  return { name, oldVersion: current, newVersion, changes }
}
