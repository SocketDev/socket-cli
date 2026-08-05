/**
 * @file Archive leaf of the first-party cache-service client — compression
 *   detection, GNU tar resolution and argv builders, the workspace-relative
 *   manifest, and the create/extract legs, all mirroring the
 *   `@actions/cache` 6.2.0 tar.js/cacheUtils.js so archives interoperate
 *   with entries the upstream client wrote. GNU tar is the only supported
 *   archiver; zstd is used when the binary answers a version probe, gzip
 *   otherwise. ./client.mts composes these into the restore/save flows and
 *   re-exports everything here, so consumers import from client.mts only.
 */

import crypto from 'node:crypto'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

// tar reads the archive members from this file (relative to the archive
// scratch dir) instead of argv, dodging command-length limits.
export const TAR_MANIFEST_FILENAME = 'manifest.txt'

// The compression methods upstream's getCompressionMethod can pick in 6.2.0:
// zstd when the binary answers a version probe, gzip otherwise. The method
// string participates in the version hash, so the values must match upstream
// byte-for-byte.
export type CacheCompressionMethod = 'gzip' | 'zstd-without-long'

/**
 * The directory cache paths are archived and extracted relative to — tar runs
 * with `-P -C <this>` on both legs, so manifest entries relativized against
 * it restore to the same absolute locations.
 */
export function cacheWorkingDirectory(
  env: Record<string, string | undefined> = process.env,
): string {
  const workspace = env['GITHUB_WORKSPACE']
  if (!workspace) {
    throw new Error(
      'The cache working directory is missing. Where: the GITHUB_WORKSPACE environment variable. Saw: unset or empty; wanted the workspace path the GitHub Actions runner injects into every job. Fix: run this inside a GitHub Actions job.',
    )
  }
  return workspace
}

/**
 * The archive filename for a compression method — upstream CacheFilename.
 */
export function cacheArchiveFileName(method: CacheCompressionMethod): string {
  return method === 'gzip' ? 'cache.tgz' : 'cache.tzst'
}

/**
 * Probe the zstd binary the way upstream getCompressionMethod does: run
 * `zstd --quiet --version` and collect its output. Throws when the binary is
 * absent; detectCompressionMethod maps that to gzip.
 */
export async function runZstdVersionProbe(): Promise<string> {
  const result = await spawn('zstd', ['--quiet', '--version'])
  return `${result.stdout}${result.stderr}`
}

/**
 * Pick the compression method: zstd when the binary answers the version
 * probe, gzip otherwise — the same decision (and the same version-hash
 * consequence) as upstream. The probe is injectable for tests.
 */
export async function detectCompressionMethod(
  probeZstd?: (() => Promise<string>) | undefined,
): Promise<CacheCompressionMethod> {
  const probe = probeZstd ?? runZstdVersionProbe
  let output: string
  try {
    output = await probe()
  } catch {
    return 'gzip'
  }
  return output.trim() === '' ? 'gzip' : 'zstd-without-long'
}

/**
 * The GNU tar on hosted Windows runners (ships with Git for Windows).
 */
export function windowsGnuTarPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return `${env['PROGRAMFILES'] ?? 'C:\\Program Files'}\\Git\\usr\\bin\\tar.exe`
}

/**
 * The tar executable per platform. GNU tar is the only supported archiver —
 * linux runners ship it as `tar`, macOS runners as `gtar`, Windows runners
 * inside Git for Windows. A Windows runner without that tar is a loud error,
 * never a BSD-tar fallback.
 */
export function resolveTarCommand(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string {
  if (platform === 'win32') {
    const gnuTar = windowsGnuTarPath(env)
    if (!existsSync(gnuTar)) {
      throw new Error(
        `GNU tar is missing on this Windows runner. Where: ${gnuTar}. Saw: no file; wanted the Git for Windows GNU tar the hosted runners ship. Fix: install Git for Windows or run on a hosted runner image.`,
      )
    }
    return gnuTar
  }
  return platform === 'darwin' ? 'gtar' : 'tar'
}

/**
 * Platform-specific GNU tar flags — upstream getTarArgs: `--force-local` on
 * Windows (a drive-letter colon is a filename, not a remote), and
 * `--delay-directory-restore` on macOS (permission ordering).
 */
export function tarPlatformArgs(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return ['--force-local']
  }
  if (platform === 'darwin') {
    return ['--delay-directory-restore']
  }
  return []
}

/**
 * The compression-program flags for the create leg — upstream
 * getCompressionProgram: multithreaded zstd (`zstdmt`, spelled `zstd -T0` on
 * Windows where no zstdmt shim ships), plain `-z` for gzip.
 */
export function tarCompressionCreateArgs(
  method: CacheCompressionMethod,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (method === 'gzip') {
    return ['-z']
  }
  return [
    '--use-compress-program',
    platform === 'win32' ? 'zstd -T0' : 'zstdmt',
  ]
}

/**
 * The decompression-program flags for the extract leg — upstream
 * getDecompressionProgram: `unzstd` (spelled `zstd -d` on Windows), plain
 * `-z` for gzip.
 */
export function tarCompressionExtractArgs(
  method: CacheCompressionMethod,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (method === 'gzip') {
    return ['-z']
  }
  return ['--use-compress-program', platform === 'win32' ? 'zstd -d' : 'unzstd']
}

/**
 * The tar argv for creating an archive — upstream getTarArgs 'create':
 * POSIX-format archive named for the compression method, self-excluded,
 * absolute paths kept (`-P`), members read from the manifest file, all
 * relative to the working directory. Runs with cwd = the archive scratch
 * dir, so the archive and manifest names stay relative.
 */
export function buildTarCreateArgs(
  method: CacheCompressionMethod,
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const archiveName = cacheArchiveFileName(method)
  return [
    '--posix',
    '-cf',
    archiveName,
    '--exclude',
    archiveName,
    '-P',
    '-C',
    normalizePath(workingDirectory),
    '--files-from',
    TAR_MANIFEST_FILENAME,
    ...tarPlatformArgs(platform),
    ...tarCompressionCreateArgs(method, platform),
  ]
}

/**
 * The tar argv for extracting an archive — upstream getTarArgs 'extract'.
 */
export function buildTarExtractArgs(
  method: CacheCompressionMethod,
  archivePath: string,
  workingDirectory: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [
    '-xf',
    normalizePath(archivePath),
    '-P',
    '-C',
    normalizePath(workingDirectory),
    ...tarPlatformArgs(platform),
    ...tarCompressionExtractArgs(method, platform),
  ]
}

/**
 * Relativize archive members against the working directory the way upstream
 * resolvePaths does — forward slashes, `.` for the workspace itself — so tar
 * entries restore to the same absolute locations on the extract leg.
 */
export function toTarManifestPaths(
  paths: readonly string[],
  workingDirectory: string,
): string[] {
  const out: string[] = []
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const relative = path.relative(workingDirectory, paths[i]!)
    out.push(relative === '' ? '.' : normalizePath(relative))
  }
  return out
}

/**
 * A fresh scratch directory under the runner temp for one archive.
 */
export function createCacheScratchDirectory(
  env: Record<string, string | undefined> = process.env,
): string {
  const base = env['RUNNER_TEMP'] || os.tmpdir()
  const dir = path.join(base, 'fleet-cache', crypto.randomUUID())
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Best-effort archive cleanup — the archive lives in the runner temp, so a
 * leftover costs disk on a throwaway VM, never correctness.
 */
export function removeArchiveQuietly(archivePath: string): void {
  try {
    safeDeleteSync(archivePath, { force: true })
  } catch {
    // A cleanup failure must never mask the real result.
  }
}

/**
 * Extract a downloaded cache archive into the working directory.
 */
export async function extractCacheArchive(
  archivePath: string,
  method: CacheCompressionMethod,
): Promise<void> {
  const workingDirectory = cacheWorkingDirectory()
  mkdirSync(workingDirectory, { recursive: true })
  const tarCommand = resolveTarCommand()
  const args = buildTarExtractArgs(method, archivePath, workingDirectory)
  try {
    await spawn(tarCommand, args)
  } catch (e) {
    throw new Error(
      `Extracting the cache archive failed. Where: ${tarCommand} ${args.join(' ')}. Saw: ${errorMessage(e)}; wanted a clean extract into ${workingDirectory}. Fix: check the archive integrity and that the compression tool (zstd/gzip) is installed.`,
    )
  }
}

export interface CacheArchive {
  archivePath: string
  sizeBytes: number
}

/**
 * Archive the given paths into a scratch dir. Missing paths are skipped the
 * way upstream's glob resolution skips them; zero existing paths is a loud
 * error.
 */
export async function createCacheArchive(
  paths: readonly string[],
  method: CacheCompressionMethod,
): Promise<CacheArchive> {
  const workingDirectory = cacheWorkingDirectory()
  const existing = paths.filter(p => existsSync(p))
  if (existing.length === 0) {
    throw new Error(
      `None of the cache paths exist on disk. Where: [${paths.join(', ')}]. Saw: zero existing paths; wanted at least one to archive. Fix: create the paths before saving, or correct the --path values.`,
    )
  }
  const archiveFolder = createCacheScratchDirectory()
  writeFileSync(
    path.join(archiveFolder, TAR_MANIFEST_FILENAME),
    toTarManifestPaths(existing, workingDirectory).join('\n'),
  )
  const tarCommand = resolveTarCommand()
  const args = buildTarCreateArgs(method, workingDirectory)
  try {
    await spawn(tarCommand, args, { cwd: archiveFolder })
  } catch (e) {
    throw new Error(
      `Creating the cache archive failed. Where: ${tarCommand} ${args.join(' ')} (cwd ${archiveFolder}). Saw: ${errorMessage(e)}; wanted a clean archive of [${existing.join(', ')}]. Fix: check the paths are readable and the compression tool (zstd/gzip) is installed.`,
    )
  }
  const archivePath = path.join(archiveFolder, cacheArchiveFileName(method))
  return { archivePath, sizeBytes: statSync(archivePath).size }
}
