/**
 * Build checkpoint manager (lean).
 *
 * Same public API as socket-btm's checkpoint-manager but sized for the
 * single-stage wasm builds in this repo (lang/{rust,cpp,go}). Each stage writes
 * a JSON marker `{ name }.json` keyed by a content hash of its source inputs +
 * platform/arch/mode. If the hash matches next run, the stage is skipped.
 *
 * What this intentionally omits vs socket-btm: - Tarball archival (socket-btm
 * archives the built artifact so CI can restore it between jobs; lang wasm
 * rebuilds take seconds, not 30 min). - Ad-hoc macOS codesign (wasm artifacts
 * don't need it). - Cross-process atomic-write ceremony (no concurrent CI jobs
 * racing on the same build dir in this repo). - restoreCheckpoint (nothing to
 * restore when there's no tarball).
 *
 * Exports mirror the names build-pipeline consumes, so the orchestrator is
 * identical across repos.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

/**
 * Platform/build metadata that feeds the cache key. Every field is optional
 * so callers can pass as much (or as little) as they know.
 */
export interface PlatformCacheKeyOptions {
  arch?: string | undefined
  buildMode?: string | undefined
  libc?: string | undefined
  nodeVersion?: string | undefined
  platform?: string | undefined
}

/**
 * Options accepted by {@link createCheckpoint}.
 */
export interface CreateCheckpointOptions extends PlatformCacheKeyOptions {
  artifactPath?: string | undefined
  binaryPath?: string | undefined
  binarySize?: string | number | undefined
  packageName?: string | undefined
  packageRoot?: string | undefined
  sourcePaths?: string[] | undefined
}

/**
 * Shape of a checkpoint JSON marker written by {@link createCheckpoint} and
 * read back by {@link getCheckpointData}.
 */
export interface CheckpointData {
  arch?: string | undefined
  artifactPath?: string | undefined
  binaryPath?: string | undefined
  binarySize?: string | number | undefined
  buildMode?: string | undefined
  cacheHash: string
  createdAt: string
  libc?: string | undefined
  name: string
  nodeVersion?: string | undefined
  packageName?: string | undefined
  platform?: string | undefined
}

export function checkpointDir(
  buildDir: string,
  packageName?: string | undefined,
) {
  return packageName
    ? path.join(buildDir, 'checkpoints', packageName)
    : path.join(buildDir, 'checkpoints')
}

export function checkpointFile(
  buildDir: string,
  packageName: string | undefined,
  name: string,
) {
  return path.join(checkpointDir(buildDir, packageName), `${name}.json`)
}

/**
 * Delete all checkpoints under a build dir (or a single package's scope).
 */
export async function cleanCheckpoint(
  buildDir: string,
  packageName?: string | undefined,
) {
  const dir = checkpointDir(buildDir, packageName)
  if (!existsSync(dir)) {
    return
  }
  await safeDelete(dir)
  logger.substep('Checkpoints cleaned')
}

export function computeCacheHash(
  sourcePaths: string[] | undefined,
  config: PlatformCacheKeyOptions,
) {
  const sourcesHash = sourcePaths?.length ? hashSourcePaths(sourcePaths) : ''
  const platformHash = platformCacheKey(config || {})
  if (!sourcesHash && !platformHash) {
    return ''
  }
  return crypto
    .createHash('sha256')
    .update(sourcesHash)
    .update('|')
    .update(platformHash)
    .digest('hex')
}

/**
 * Run `smokeTest`, then write a checkpoint JSON marker.
 *
 * @param {string} buildDir
 * @param {string} name - Checkpoint name (must be a CHECKPOINTS value).
 * @param {() => Promise<void>} smokeTest - Throws if the stage output is
 *   invalid.
 * @param {object} [options]
 * @param {string} [options.packageName]
 * @param {string} [options.artifactPath] - Informational; recorded in JSON.
 * @param {string} [options.binaryPath] - Informational; recorded in JSON.
 * @param {string | number} [options.binarySize] - Informational; recorded in
 *   JSON.
 * @param {string[]} [options.sourcePaths] - Inputs hashed into the cache key.
 * @param {string} [options.buildMode]
 * @param {string} [options.nodeVersion]
 * @param {string} [options.platform]
 * @param {string} [options.arch]
 * @param {string} [options.libc]
 * @param {string} [options.packageRoot]
 */
export async function createCheckpoint(
  buildDir: string,
  name: string,
  smokeTest: () => Promise<void>,
  options: CreateCheckpointOptions = {},
) {
  if (typeof smokeTest !== 'function') {
    throw new Error(
      `createCheckpoint('${name}'): expected smokeTest callback as argument 3, got ${typeof smokeTest}.`,
    )
  }

  const {
    arch,
    artifactPath,
    binaryPath,
    binarySize,
    buildMode,
    libc,
    nodeVersion,
    packageName = '',
    packageRoot,
    platform,
    sourcePaths,
  } = options

  try {
    await smokeTest()
  } catch (e) {
    throw new Error(
      `Smoke test failed for checkpoint '${name}': ${errorMessage(e)}`,
      { cause: e },
    )
  }

  const dir = checkpointDir(buildDir, packageName)
  await safeMkdir(dir)

  const cacheHash = computeCacheHash(sourcePaths, {
    arch,
    buildMode,
    libc,
    nodeVersion,
    platform,
  })

  const data = {
    name,
    createdAt: new Date().toISOString(),
    cacheHash,
    artifactPath,
    binaryPath,
    binarySize,
    platform,
    arch,
    libc,
    buildMode,
    nodeVersion,
  }

  const file = checkpointFile(buildDir, packageName, name)
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')

  const relRoot = packageRoot ? path.relative(packageRoot, file) : file
  // oxlint-disable-next-line socket/no-status-emoji -- substep takes its own indent prefix; ✓ marks completion.
  logger.substep(`✓ Checkpoint ${name} written (${relRoot})`)
}

/**
 * Read a checkpoint's JSON data, or undefined if it does not exist.
 */
export async function getCheckpointData(
  buildDir: string,
  packageName: string | undefined,
  name: string,
): Promise<CheckpointData | undefined> {
  const file = checkpointFile(buildDir, packageName, name)
  if (!existsSync(file)) {
    return undefined
  }
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as CheckpointData
  } catch (e) {
    logger.warn(
      `Checkpoint ${name} JSON unreadable (${errorMessage(e)}) — ignoring`,
    )
    return undefined
  }
}

/**
 * Does a checkpoint JSON marker exist?
 */
export function hasCheckpoint(
  buildDir: string,
  packageName: string | undefined,
  name: string,
) {
  return existsSync(checkpointFile(buildDir, packageName, name))
}

export function hashSourcePaths(sourcePaths: string[]) {
  const hash = crypto.createHash('sha256')
  const sortedPaths = [...sourcePaths].toSorted()
  for (let i = 0, { length } = sortedPaths; i < length; i += 1) {
    const file = sortedPaths[i]!
    hash.update(`${file}:`)
    if (existsSync(file)) {
      try {
        hash.update(readFileSync(file))
      } catch (e) {
        const code =
          e instanceof Error ? (e as NodeJS.ErrnoException).code : undefined
        if (code !== 'ENOENT') {
          throw e
        }
      }
    }
  }
  return hash.digest('hex')
}

export function platformCacheKey({
  buildMode,
  nodeVersion,
  platform,
  arch,
  libc,
}: PlatformCacheKeyOptions) {
  const parts = [
    buildMode && `mode=${buildMode}`,
    nodeVersion && `node=${nodeVersion}`,
    platform && `platform=${platform}`,
    arch && `arch=${arch}`,
    libc && `libc=${libc}`,
  ].filter(Boolean)
  if (!parts.length) {
    return ''
  }
  return crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 16)
}

/**
 * Should the stage run? True if force, no checkpoint, missing cache hash, or
 * the hash no longer matches current inputs.
 */
export async function shouldRun(
  buildDir: string,
  packageName: string | undefined,
  name: string,
  force = false,
  sourcePaths?: string[] | undefined,
  options: PlatformCacheKeyOptions = {},
) {
  if (force) {
    return true
  }
  if (!hasCheckpoint(buildDir, packageName, name)) {
    return true
  }

  // Only validate hash if the caller provided inputs or platform metadata.
  const wantsValidation =
    sourcePaths?.length || options.buildMode || options.platform || options.arch

  if (!wantsValidation) {
    return false
  }

  const data = await getCheckpointData(buildDir, packageName, name)
  if (!data) {
    return true
  }

  const expected = computeCacheHash(sourcePaths, options)
  if (!data.cacheHash || data.cacheHash !== expected) {
    logger.substep(`Checkpoint ${name} stale (cache hash changed) — rebuilding`)
    return true
  }

  return false
}
