/**
 * @file Verification + command helpers for the cross-org binary-tail publish
 *   stager. Split out of `multi-package-publish.mts` so the verify primitives
 *   (tag-version extract, SHA256SUMS parse, archive lookup, sha256 digest, `gh
 *   attestation verify`, triplet validation) and the `gh`/spawn runners live
 *   separately from the stage pipeline that orchestrates them. The pipeline
 *   imports these; `MultiPackageStageError` is imported back from the main file
 *   (class-import cycle, safe at runtime — nothing executes at module load).
 */

import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { MultiPackageStageError } from './multi-package-publish.mts'
import { isPackAppTriplet, parseTripletSegment } from './pack-app-triplets.mts'
import type { PackAppTriplet } from './pack-app-triplets.mts'
import type {
  GitHubRepoSlug,
  SourceAllowlistVersionScheme,
} from './source-allowlist.mts'

/**
 * Extract the version segment from a release tag.
 *
 * `versionScheme` `'semver'` (default) works for the common shape
 * `<family>-<semver>` (the pattern's literal prefix is everything before
 * `\d`). `'date-shortsha'` works for a `<family>-<yyyymmdd>-<shortsha>` tag —
 * a build-date + git short-sha with no semver in it — and maps the matched
 * segment to the npm-legal CalVer `<yyyymmdd>.0.0-<shortsha>`. For more exotic
 * patterns the caller can override by post-processing the result.
 */
export function extractVersionFromTag(
  tag: string,
  pattern: RegExp,
  versionScheme: SourceAllowlistVersionScheme = 'semver',
): string | undefined {
  if (versionScheme === 'date-shortsha') {
    // Try to find the date + short-sha sub-match, e.g. `binflate-20260507-f1e66a5`.
    const dateShaMatch = tag.match(/(\d{8})-([0-9a-f]+)$/)
    if (!dateShaMatch) {
      return undefined
    }
    // Sanity check the full tag still matches the allowlist pattern.
    if (!pattern.test(tag)) {
      return undefined
    }
    return `${dateShaMatch[1]}.0.0-${dateShaMatch[2]}`
  }
  // Try to find the version directly via a sub-match. Common patterns
  // use `\d+\.\d+\.\d+(?:-[\w.]+)?` for the version.
  const versionMatch = tag.match(/\d+\.\d+\.\d+(?:-[\w.]+)?$/)
  if (!versionMatch) {
    return undefined
  }
  // Sanity check the full tag still matches the allowlist pattern.
  if (!pattern.test(tag)) {
    return undefined
  }
  return versionMatch[0]
}

/**
 * Parse a SHA256SUMS file (one `<sha> <filename>` line per archive) into a map
 * keyed by filename.
 */
export function parseShaSums(text: string): Map<string, string> {
  const result = new Map<string, string>()
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    // Format: `<64-hex>  <filename>` (two spaces per coreutils sha256sum).
    const match = line.match(/^([0-9a-f]{64})\s+(?:\*)?(.+)$/i)
    if (match) {
      result.set(match[2]!.trim(), match[1]!.toLowerCase())
    }
  }
  return result
}

/**
 * Find the archive in `dir` matching the family prefix + triplet. Accepts
 * `.tgz` or `.tar.gz` suffix. Returns the basename or undefined.
 */
export function findArchiveForTriplet(
  dir: string,
  namePrefix: string,
  triplet: PackAppTriplet,
): string | undefined {
  const candidates = [
    `${namePrefix}${triplet}.tgz`,
    `${namePrefix}${triplet}.tar.gz`,
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]!
    if (existsSync(path.join(dir, candidate))) {
      return candidate
    }
  }
  return undefined
}

/**
 * Find the raw, extension-less per-triplet binary in `dir` matching
 * `<binaryName>-<triplet>` (`.exe` appended for `win32-*` triplets). Used by
 * `cli` families that ship a standalone binary per release asset instead of a
 * tarball — no `package.json` to extract, so the asset itself is the staged
 * artifact. Returns the basename or undefined.
 */
export function findRawBinaryForTriplet(
  dir: string,
  binaryName: string,
  triplet: PackAppTriplet,
): string | undefined {
  const exe = triplet.startsWith('win32-') ? '.exe' : ''
  const candidate = `${binaryName}-${triplet}${exe}`
  return existsSync(path.join(dir, candidate)) ? candidate : undefined
}

/**
 * Compute sha256 hex digest of a file's contents.
 */
export function sha256Of(filePath: string): string {
  const buf = readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export async function runCommand(
  cmd: string,
  args: readonly string[],
  cwd: string,
): Promise<RunResult> {
  const result = await spawn(cmd, [...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  return {
    code: result.code ?? 1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
}

export async function runGh(
  args: readonly string[],
  cwd: string,
): Promise<RunResult> {
  return runCommand('gh', args, cwd)
}

/**
 * Wrap `gh attestation verify` against the row's signer-workflow. Throws
 * `MultiPackageStageError` on non-zero exit so the caller's try/catch chain
 * stops the stage.
 */
export async function verifyAttestation(
  artifactPath: string,
  sourceRepo: GitHubRepoSlug,
  signerWorkflow: string,
  command: typeof runCommand = runCommand,
): Promise<void> {
  const result = await command(
    'gh',
    [
      'attestation',
      'verify',
      artifactPath,
      '--repo',
      sourceRepo,
      '--signer-workflow',
      signerWorkflow,
    ],
    path.dirname(artifactPath),
  )
  if (result.code !== 0) {
    throw new MultiPackageStageError(
      `gh attestation verify failed for ${path.basename(artifactPath)} (exit ${result.code}): ${result.stderr}`,
      'attestation',
      parseTripletSegment(
        path.basename(artifactPath).replace(/\.(?:tar\.gz|tgz)$/, ''),
      ),
    )
  }
}

/**
 * Validate that a CLI-supplied string is one of the canonical triplets. Throws
 * `MultiPackageStageError` if not, so CLI parsing surfaces a proper error.
 */
export function assertTripletList(values: readonly string[]): PackAppTriplet[] {
  const result: PackAppTriplet[] = []
  for (let i = 0, { length } = values; i < length; i += 1) {
    const value = values[i]!
    if (!isPackAppTriplet(value)) {
      throw new MultiPackageStageError(
        `${value} is not a canonical pnpm pack-app triplet.`,
        'triplet-conformance',
      )
    }
    result.push(value)
  }
  return result
}
