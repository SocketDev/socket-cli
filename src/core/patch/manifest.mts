import crypto from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, rename } from 'node:fs/promises'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { strictDelete } from '@socketsecurity/lib-stable/fs/strict'
import { isPlainObject } from '@socketsecurity/lib-stable/objects/predicates'
import {
  getDefaultFormatting,
  stringifyWithFormatting,
} from '@socketsecurity/lib-stable/json/format'

import type { Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

export interface PatchFileHashes {
  beforeHash: string
  afterHash: string
}

export interface PatchVulnerability {
  cves: string[]
  summary: string
  severity: string
  description: string
}

export interface PatchManifestRecord {
  uuid: string
  exportedAt: string
  files: Record<string, PatchFileHashes>
  vulnerabilities: Record<string, PatchVulnerability>
  description: string
  license: string
  tier: string
}

export interface PatchManifest {
  patches: Record<string, PatchManifestRecord>
  [key: string]: unknown
}

export interface PatchManifestPaths {
  socketDirectory: string
  manifestPath: string
}

export class PatchManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PatchManifestError'
  }
}

export function assertPatchManifest(
  value: unknown,
): asserts value is PatchManifest {
  if (!isPlainObject(value) || !isPlainObject(value['patches'])) {
    throw new PatchManifestError('Manifest must contain a patches object')
  }

  for (const [purl, candidate] of Object.entries(value['patches'])) {
    if (!isPatchManifestRecord(candidate)) {
      throw new PatchManifestError(`Manifest patch record is invalid: ${purl}`)
    }
  }
}

export async function ensureManifestTarget(
  manifestPath: string,
): Promise<void> {
  try {
    const targetStat = await lstat(manifestPath)
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
      throw new PatchManifestError(
        `Manifest target at ${manifestPath} must be a regular file`,
      )
    }
  } catch (error) {
    if (!isPatchNodeErrorCode(error, 'ENOENT')) {
      throw error
    }
  }
}

export async function ensureSocketDirectory(
  socketDirectory: string,
): Promise<void> {
  try {
    const directoryStat = await lstat(socketDirectory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new PatchManifestError(
        `Patch state directory at ${socketDirectory} must be a real directory`,
      )
    }
  } catch (error) {
    if (!isPatchNodeErrorCode(error, 'ENOENT')) {
      throw error
    }
    try {
      await mkdir(socketDirectory, { mode: 0o700 })
    } catch (mkdirError) {
      if (!isPatchNodeErrorCode(mkdirError, 'EEXIST')) {
        throw new PatchManifestError(
          `Could not create patch state directory at ${socketDirectory}: ${errorMessage(mkdirError)}`,
        )
      }
    }
    const directoryStat = await lstat(socketDirectory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new PatchManifestError(
        `Patch state directory at ${socketDirectory} must be a real directory`,
      )
    }
  }
}

export function getPatchManifestPaths(projectRoot: string): PatchManifestPaths {
  const socketDirectory = path.join(path.resolve(projectRoot), '.socket')
  return {
    socketDirectory,
    manifestPath: path.join(socketDirectory, 'manifest.json'),
  }
}

export function isPatchManifestRecord(
  value: unknown,
): value is PatchManifestRecord {
  if (
    !isPlainObject(value) ||
    typeof value['uuid'] !== 'string' ||
    typeof value['exportedAt'] !== 'string' ||
    typeof value['description'] !== 'string' ||
    typeof value['license'] !== 'string' ||
    typeof value['tier'] !== 'string' ||
    !isPlainObject(value['files']) ||
    !isPlainObject(value['vulnerabilities'])
  ) {
    return false
  }

  const validFiles = Object.values(value['files']).every(
    file =>
      isPlainObject(file) &&
      typeof file['beforeHash'] === 'string' &&
      typeof file['afterHash'] === 'string',
  )
  const validVulnerabilities = Object.values(value['vulnerabilities']).every(
    vulnerability =>
      isPlainObject(vulnerability) &&
      Array.isArray(vulnerability['cves']) &&
      vulnerability['cves'].every(cve => typeof cve === 'string') &&
      typeof vulnerability['summary'] === 'string' &&
      typeof vulnerability['severity'] === 'string' &&
      typeof vulnerability['description'] === 'string',
  )
  return validFiles && validVulnerabilities
}

export function isPatchNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

export function matchingPatchEntries(
  manifest: PatchManifest,
  identifier: string,
): Array<[string, PatchManifestRecord]> {
  const normalizedIdentifier = identifier.trim()
  const matches = Object.entries(manifest.patches).filter(
    ([purl, record]) =>
      purl === normalizedIdentifier || record.uuid === normalizedIdentifier,
  )
  return matches.toSorted(([a], [b]) => a.localeCompare(b))
}

export function parsePatchManifest(source: string): PatchManifest {
  let value: unknown
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new PatchManifestError(
      `Manifest JSON is invalid: ${errorMessage(error)}`,
    )
  }

  assertPatchManifest(value)
  return value
}

export async function readPatchManifest(
  projectRoot: string,
): Promise<PatchManifest | undefined> {
  const { socketDirectory, manifestPath } = getPatchManifestPaths(projectRoot)
  try {
    const directoryStat = await lstat(socketDirectory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new PatchManifestError(
        `Patch state directory at ${socketDirectory} must be a real directory`,
      )
    }
  } catch (error) {
    if (isPatchNodeErrorCode(error, 'ENOENT')) {
      return undefined
    }
    throw error
  }

  let fileStat: Stats
  try {
    fileStat = await lstat(manifestPath)
  } catch (error) {
    if (isPatchNodeErrorCode(error, 'ENOENT')) {
      return undefined
    }
    throw new PatchManifestError(
      `Could not inspect manifest at ${manifestPath}: ${errorMessage(error)}`,
    )
  }

  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new PatchManifestError(
      `Manifest at ${manifestPath} must be a regular file`,
    )
  }

  let source: string
  let file: FileHandle | undefined
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0
    file = await open(manifestPath, fsConstants.O_RDONLY | noFollow)
    const openedStat = await file.stat()
    if (!openedStat.isFile()) {
      throw new PatchManifestError(
        `Manifest at ${manifestPath} must be a regular file`,
      )
    }
    source = await file.readFile('utf8')
  } catch (error) {
    throw new PatchManifestError(
      `Could not read manifest at ${manifestPath}: ${errorMessage(error)}`,
    )
  } finally {
    await file?.close()
  }

  try {
    return parsePatchManifest(source)
  } catch (error) {
    throw new PatchManifestError(
      `Invalid manifest at ${manifestPath}: ${errorMessage(error)}`,
    )
  }
}

export async function writePatchManifest(
  projectRoot: string,
  manifest: PatchManifest,
): Promise<void> {
  const { socketDirectory, manifestPath } = getPatchManifestPaths(projectRoot)
  await ensureSocketDirectory(socketDirectory)
  await ensureManifestTarget(manifestPath)

  const temporaryPath = path.join(
    socketDirectory,
    `.manifest-${process.pid}-${crypto.randomUUID()}.tmp`,
  )
  const content = stringifyWithFormatting(manifest, getDefaultFormatting())
  const file = await open(temporaryPath, 'wx', 0o600)
  try {
    await file.writeFile(content, 'utf8')
    await file.sync()
  } catch (error) {
    await file.close()
    await strictDelete(temporaryPath, { base: socketDirectory }).catch(
      () => undefined,
    )
    throw new PatchManifestError(
      `Could not write manifest at ${manifestPath}: ${errorMessage(error)}`,
    )
  }
  await file.close()

  try {
    await rename(temporaryPath, manifestPath)
  } catch (error) {
    await strictDelete(temporaryPath, { base: socketDirectory }).catch(
      () => undefined,
    )
    throw new PatchManifestError(
      `Could not replace manifest at ${manifestPath}: ${errorMessage(error)}`,
    )
  }
}
