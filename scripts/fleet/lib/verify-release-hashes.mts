/**
 * @file Three-way release-tarball hash gate. Assert the LOCAL packed tarball,
 *   the GitHub Release asset, and the npm registry entry carry the same digest
 *   before an operator promotes a staged publish to public. A same-run
 *   `pnpm pack` feeds all three, so the bytes should match exactly; any
 *   divergence means a wrong-artifact upload, a stale asset, or tampering — a
 *   hard stop, never a logged hint (the fleet "fail LOUD" rule). The release
 *   orchestrator runs this immediately before `publish.mts --approve`. Registry
 *   and GitHub access are injected so the comparison logic unit-tests without a
 *   network or `gh`.
 */

import crypto from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { fetchVersionTrustInfo } from '../publish-infra/npm/registry.mts'

const WIN32 = process.platform === 'win32'

/**
 * Options for the default GitHub-asset digest fetcher. `assetName` is the
 * release asset filename (the same basename the local `pnpm pack` produced).
 */
export interface GitHubAssetDigestConfig {
  assetName: string
  cwd: string
  tag: string
}

/**
 * The outcome of comparing hash sources. `algorithm` names which axis actually
 * verified — `integrity` (sha512 SRI, preferred) when every source carries it,
 * else `shasum` (sha1) as a fallback, else `undefined` when no single axis is
 * present on every source (insufficient to verify → not ok).
 */
export interface HashComparison {
  algorithm: 'integrity' | 'shasum' | undefined
  digest: string | undefined
  disagreeing: readonly string[]
  ok: boolean
  reason: string | undefined
}

/**
 * One artifact's digest, labeled by origin. A source may omit a field: a staged
 * (not-yet-approved) npm version exposes only `shasum` via `pnpm stage list`,
 * not `integrity`.
 */
export interface HashSource {
  integrity: string | undefined
  label: string
  shasum: string | undefined
}

/**
 * A tarball's npm-shaped digests: `integrity` in SRI form (`sha512-<base64>`,
 * matching npm `dist.integrity`) and `shasum` as sha1 hex (matching npm
 * `dist.shasum`).
 */
export interface TarballDigest {
  integrity: string
  shasum: string
}

export interface VerifyReleaseHashesConfig {
  cwd: string
  fetchGitHubAssetDigest?:
    | ((options: GitHubAssetDigestConfig) => Promise<HashSource>)
    | undefined
  fetchRegistryDigest?:
    | ((name: string, version: string) => Promise<HashSource>)
    | undefined
  hashLocalTarball?: ((filePath: string) => TarballDigest) | undefined
  localTarball: string
  name: string
  tag: string
  version: string
}

/**
 * Thrown by `verifyReleaseHashes` when the three sources are not proven
 * identical. Carries the structured `comparison` so a caller can render its own
 * report; the message is already fail-loud (What / Where / Saw-vs-wanted /
 * Fix).
 */
export class ReleaseHashMismatchError extends Error {
  readonly comparison: HashComparison
  constructor(message: string, comparison: HashComparison) {
    super(message)
    this.name = 'ReleaseHashMismatchError'
    this.comparison = comparison
  }
}

/**
 * Compute the npm-shaped digests of a buffer: sha512 SRI + sha1 hex.
 */
export function hashBuffer(buffer: Buffer): TarballDigest {
  return {
    integrity: `sha512-${crypto.createHash('sha512').update(buffer).digest('base64')}`,
    shasum: crypto.createHash('sha1').update(buffer).digest('hex'),
  }
}

/**
 * Read a tarball off disk and return its npm-shaped digests.
 */
export function hashTarball(filePath: string): TarballDigest {
  return hashBuffer(readFileSync(filePath))
}

/**
 * Compare hash sources for byte-identity. Prefers sha512 `integrity` when every
 * source carries it (a mismatch there is a hard fail — it never falls through
 * to the weaker sha1), else falls back to `shasum` when every source carries
 * that, else reports insufficient. The first source is the reference.
 */
export function compareHashSources(
  sources: readonly HashSource[],
): HashComparison {
  if (sources.length < 2) {
    return {
      algorithm: undefined,
      digest: undefined,
      disagreeing: [],
      ok: false,
      reason: `need at least 2 hash sources to compare, got ${sources.length}`,
    }
  }
  const axes = ['integrity', 'shasum'] as const
  for (let i = 0, { length } = axes; i < length; i += 1) {
    const axis = axes[i]!
    if (!sources.every(source => source[axis])) {
      continue
    }
    const reference = sources[0]![axis]!
    const disagreeing = sources
      .filter(source => source[axis] !== reference)
      .map(source => source.label)
    return {
      algorithm: axis,
      digest: reference,
      disagreeing,
      ok: disagreeing.length === 0,
      reason:
        disagreeing.length === 0
          ? undefined
          : `${axis} of ${disagreeing.join(', ')} differs from ${sources[0]!.label}`,
    }
  }
  return {
    algorithm: undefined,
    digest: undefined,
    disagreeing: sources
      .filter(source => !source.integrity && !source.shasum)
      .map(source => source.label),
    ok: false,
    reason:
      'no single hash algorithm is present on every source (need integrity OR shasum on all)',
  }
}

/**
 * Verify the local tarball, the GitHub release asset, and the npm registry
 * entry are byte-identical. Resolves with the passing `HashComparison`; throws
 * `ReleaseHashMismatchError` on any divergence or insufficiency. Network and
 * `gh` access default to the real fetchers below but are injectable for tests
 * and for the pre-approve path (which supplies the staged shasum from `pnpm
 * stage list`, since a staged version is not yet in the public packument).
 */
export async function verifyReleaseHashes(
  config: VerifyReleaseHashesConfig,
): Promise<HashComparison> {
  const cfg = { __proto__: null, ...config } as VerifyReleaseHashesConfig
  const hashLocal = cfg.hashLocalTarball ?? hashTarball
  const fetchGitHub =
    cfg.fetchGitHubAssetDigest ?? defaultFetchGitHubAssetDigest
  const fetchRegistry = cfg.fetchRegistryDigest ?? defaultFetchRegistryDigest
  const local = hashLocal(cfg.localTarball)
  const [github, registry] = await Promise.all([
    fetchGitHub({
      assetName: path.basename(cfg.localTarball),
      cwd: cfg.cwd,
      tag: cfg.tag,
    }),
    fetchRegistry(cfg.name, cfg.version),
  ])
  const sources: HashSource[] = [
    { integrity: local.integrity, label: 'local pack', shasum: local.shasum },
    github,
    registry,
  ]
  const comparison = compareHashSources(sources)
  if (!comparison.ok) {
    throw new ReleaseHashMismatchError(
      buildMismatchMessage(cfg, sources, comparison),
      comparison,
    )
  }
  return comparison
}

function buildMismatchMessage(
  config: VerifyReleaseHashesConfig,
  sources: readonly HashSource[],
  comparison: HashComparison,
): string {
  const cfg = { __proto__: null, ...config } as typeof config
  const axis = comparison.algorithm ?? 'integrity/shasum'
  const rows = sources
    .map(
      source =>
        `    ${source.label}: ${source.integrity ?? source.shasum ?? '(none)'}`,
    )
    .join('\n')
  return (
    `Release hash verification failed for ${cfg.name}@${cfg.version}.\n` +
    `  Where: comparing local pack vs GitHub release ${cfg.tag} vs npm registry (${axis}).\n` +
    `  Saw vs wanted: ${comparison.reason ?? 'sources disagree'}; sources:\n${rows}\n` +
    `  Fix: reject the staged publish (pnpm stage reject <stageId>) and re-run the release — never approve a divergent artifact.`
  )
}

/**
 * Default registry digest: reads the PUBLIC packument, so it sees a version
 * only after it is approved/public. The pre-approve gate injects its own
 * fetcher backed by `pnpm stage list --json`.
 */
async function defaultFetchRegistryDigest(
  name: string,
  version: string,
): Promise<HashSource> {
  const info = await fetchVersionTrustInfo(name, 'abbreviated')
  const entry = info[version]
  return {
    integrity: entry?.integrity,
    label: 'npm registry',
    shasum: entry?.shasum,
  }
}

async function defaultFetchGitHubAssetDigest(
  config: GitHubAssetDigestConfig,
): Promise<HashSource> {
  const cfg = { __proto__: null, ...config } as GitHubAssetDigestConfig
  const dir = mkdtempSync(path.join(os.tmpdir(), 'release-verify-'))
  const result = await spawn(
    'gh',
    [
      'release',
      'download',
      cfg.tag,
      '--pattern',
      cfg.assetName,
      '--dir',
      dir,
      '--clobber',
    ],
    {
      cwd: cfg.cwd,
      shell: WIN32,
      stdio: ['ignore', 'pipe', 'pipe'],
      stdioString: true,
    },
  ).catch((e: unknown) => ({ code: 1, stderr: errorMessage(e) }))
  const code = (result as { code?: number | null | undefined }).code ?? 1
  if (code !== 0) {
    throw new Error(
      `Could not download the GitHub release asset for hash verification.\n` +
        `  Where: gh release download ${cfg.tag} --pattern ${cfg.assetName}\n` +
        `  Saw: gh exited ${code}\n` +
        `  Fix: confirm the release ${cfg.tag} exists and carries the asset ${cfg.assetName}.`,
    )
  }
  const files = readdirSync(dir)
  const downloaded = files.includes(cfg.assetName) ? cfg.assetName : files[0]
  if (!downloaded) {
    throw new Error(
      `The GitHub release download produced no file.\n` +
        `  Where: ${dir} after gh release download ${cfg.tag}\n` +
        `  Saw: empty directory\n` +
        `  Fix: confirm the asset ${cfg.assetName} is attached to release ${cfg.tag}.`,
    )
  }
  return {
    label: 'GitHub release',
    ...hashTarball(path.join(dir, downloaded)),
  }
}
