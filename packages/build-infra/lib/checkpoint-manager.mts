/**
 * Build checkpoint manager (lean).
 *
 * Same public API as socket-btm's checkpoint-manager but sized for the
 * single-stage wasm builds in this repo (lang/{rust,cpp,go}). Each stage
 * writes a JSON marker `{ name }.json` keyed by a content hash of its
 * source inputs + platform/arch/mode. If the hash matches next run, the
 * stage is skipped.
 *
 * What this intentionally omits vs socket-btm:
 *   - Tarball archival (socket-btm archives the built artifact so CI can
 *     restore it between jobs; lang wasm rebuilds take seconds, not 30 min).
 *   - Ad-hoc macOS codesign (wasm artifacts don't need it).
 *   - Cross-process atomic-write ceremony (no concurrent CI jobs racing on
 *     the same build dir in this repo).
 *   - restoreCheckpoint (nothing to restore when there's no tarball).
 *
 * Exports mirror the names build-pipeline consumes, so the orchestrator is
 * identical across repos.
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

function checkpointDir(buildDir, packageName) {
  return packageName
    ? path.join(buildDir, 'checkpoints', packageName)
    : path.join(buildDir, 'checkpoints')
}

function checkpointFile(buildDir, packageName, name) {
  return path.join(checkpointDir(buildDir, packageName), `${name}.json`)
}

function hashSourcePaths(sourcePaths) {
  const hash = createHash('sha256')
  for (const file of [...sourcePaths].sort()) {
    hash.update(`${file}:`)
    if (existsSync(file)) {
      try {
        hash.update(readFileSync(file))
      } catch (e) {
        if (e.code !== 'ENOENT') {
          throw e
        }
      }
    }
  }
  return hash.digest('hex')
}

function platformCacheKey({ buildMode, nodeVersion, platform, arch, libc }) {
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
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

function computeCacheHash(sourcePaths, options) {
  const sourcesHash = sourcePaths?.length ? hashSourcePaths(sourcePaths) : ''
  const platformHash = platformCacheKey(options || {})
  if (!sourcesHash && !platformHash) {
    return ''
  }
  return createHash('sha256')
    .update(sourcesHash)
    .update('|')
    .update(platformHash)
    .digest('hex')
}

/**
 * Does a checkpoint JSON marker exist?
 */
export function hasCheckpoint(buildDir, packageName, name) {
  return existsSync(checkpointFile(buildDir, packageName, name))
}

/**
 * Read a checkpoint's JSON data, or undefined if it does not exist.
 */
export async function getCheckpointData(buildDir, packageName, name) {
  const file = checkpointFile(buildDir, packageName, name)
  if (!existsSync(file)) {
    return undefined
  }
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (e) {
    logger.warn(
      `Checkpoint ${name} JSON unreadable (${errorMessage(e)}) — ignoring`,
    )
    return undefined
  }
}

/**
 * Run `smokeTest`, then write a checkpoint JSON marker.
 *
 * @param {string} buildDir
 * @param {string} name - Checkpoint name (must be a CHECKPOINTS value).
 * @param {() => Promise<void>} smokeTest - Throws if the stage output is invalid.
 * @param {object} [options]
 * @param {string} [options.packageName]
 * @param {string} [options.artifactPath] - Informational; recorded in JSON.
 * @param {string} [options.binaryPath] - Informational; recorded in JSON.
 * @param {string|number} [options.binarySize] - Informational; recorded in JSON.
 * @param {string[]} [options.sourcePaths] - Inputs hashed into the cache key.
 * @param {string} [options.buildMode]
 * @param {string} [options.nodeVersion]
 * @param {string} [options.platform]
 * @param {string} [options.arch]
 * @param {string} [options.libc]
 * @param {string} [options.packageRoot]
 */
export async function createCheckpoint(
  buildDir,
  name,
  smokeTest,
  options = {},
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
  logger.substep(`✓ Checkpoint ${name} written (${relRoot})`)
}

/**
 * Should the stage run? True if force, no checkpoint, missing cache hash,
 * or the hash no longer matches current inputs.
 */
export async function shouldRun(
  buildDir,
  packageName,
  name,
  force = false,
  sourcePaths,
  options = {},
) {
  if (force) {
    return true
  }
  if (!hasCheckpoint(buildDir, packageName, name)) {
    return true
  }

  // Only validate hash if the caller provided inputs or platform metadata.
  const wantsValidation =
    (sourcePaths && sourcePaths.length) ||
    options.buildMode ||
    options.platform ||
    options.arch

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

/**
 * Delete all checkpoints under a build dir (or a single package's scope).
 */
export async function cleanCheckpoint(buildDir, packageName) {
  const dir = checkpointDir(buildDir, packageName)
  if (!existsSync(dir)) {
    return
  }
  await safeDelete(dir)
  logger.substep('Checkpoints cleaned')
}
