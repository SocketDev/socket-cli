#!/usr/bin/env node
/* eslint-disable no-await-in-loop -- Target builds mutate shared staging and output paths. */
/** Build a self-contained root Socket CLI using the pinned Node 27 SEA/VFS APIs. */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { parse as parseYaml } from 'yaml'

import { seaArchivePaths } from './archive-paths.mts'
import { acquireBuildLock } from './build/lock.mts'
import { publishArtifactPair } from './build/publish.mts'
import { createSeaCapabilities } from './capabilities.mts'
import { downloadBytes } from './download-bytes.mts'
import { cachedDownload } from './download-cache.mts'
import { stageSynp } from './stage-synp.mts'
import { stageUv } from './stage-uv.mts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const NODE_VERSION = '27.0.0-alpha.0.0.0'
const MAX_PINNED_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_NODE_SUMS_BYTES = 1024 * 1024
// `pnpm build:dist:src` starts by deleting `dist/`. Keep SEA artifacts outside
// that managed distribution tree so an ordinary package build cannot erase
// the output of a preceding SEA build.
const DEFAULT_OUT = path.join(ROOT, 'build/sea')
const TARGETS = [
  ['darwin', 'arm64', 'darwin-arm64'],
  ['darwin', 'x64', 'darwin-x64'],
  ['linux', 'arm64', 'linux-arm64'],
  ['linux', 'x64', 'linux-x64'],
  ['win32', 'arm64', 'win-arm64'],
  ['win32', 'x64', 'win-x64'],
] as const

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

async function digestFile(filename: string): Promise<string> {
  return sha256(await fs.readFile(filename))
}

async function digestTree(directory: string): Promise<string> {
  const entries: Array<{
    path: string
    type: 'file' | 'symlink'
    mode: number
    sha256?: string
    target?: string
  }> = []
  const visit = async (current: string): Promise<void> => {
    const names = (await fs.readdir(current)).sort()
    for (const name of names) {
      const fullPath = path.join(current, name)
      const relativePath = path
        .relative(directory, fullPath)
        .split(path.sep)
        .join('/')
      const stat = await fs.lstat(fullPath)
      if (stat.isDirectory()) {
        await visit(fullPath)
      } else if (stat.isFile()) {
        entries.push({
          path: relativePath,
          type: 'file',
          mode: stat.mode & 0o7777,
          sha256: await digestFile(fullPath),
        })
      } else if (stat.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          type: 'symlink',
          mode: stat.mode & 0o7777,
          target: await fs.readlink(fullPath),
        })
      } else {
        throw new Error(`Unsupported non-file SEA payload entry: ${fullPath}`)
      }
    }
  }
  await visit(directory)
  if (entries.length === 0) {
    throw new Error(`Required SEA payload directory is empty: ${directory}`)
  }
  return sha256(Buffer.from(JSON.stringify(entries)))
}

async function listThirdPartyArtifacts(
  directory: string,
  vfsPrefix: string,
): Promise<{
  inventories: Array<{ path: string; sha256: string }>
  documents: Array<{ path: string; sha256: string }>
}> {
  const inventories: Array<{ path: string; sha256: string }> = []
  const documents: Array<{ path: string; sha256: string }> = []
  const visit = async (current: string): Promise<void> => {
    for (const name of (await fs.readdir(current)).sort()) {
      const fullPath = path.join(current, name)
      const stat = await fs.lstat(fullPath)
      if (stat.isDirectory()) {
        await visit(fullPath)
      } else if (stat.isFile()) {
        const relative = path
          .relative(directory, fullPath)
          .split(path.sep)
          .join('/')
        const entry = {
          path: `${vfsPrefix}/${relative}`,
          sha256: await digestFile(fullPath),
        }
        if (/^THIRD-PARTY-NOTICES(?:-[A-Za-z0-9._-]+)?\.json$/.test(name)) {
          inventories.push(entry)
        } else if (relative.includes('third-party-notices/')) {
          documents.push(entry)
        }
      }
    }
  }
  await visit(directory)
  inventories.sort((left, right) => left.path.localeCompare(right.path))
  documents.sort((left, right) => left.path.localeCompare(right.path))
  return { inventories, documents }
}

async function normalizeTreeTimestamps(directory: string): Promise<void> {
  const fixedTimestamp = Date.UTC(1980, 0, 1) / 1000
  const visit = async (current: string): Promise<void> => {
    const names = (await fs.readdir(current)).sort()
    for (const name of names) {
      const fullPath = path.join(current, name)
      const stat = await fs.lstat(fullPath)
      if (stat.isDirectory()) {
        await visit(fullPath)
      } else if (!stat.isFile()) {
        throw new Error(`Unsupported cdxgen payload entry: ${fullPath}`)
      }
      await fs.utimes(fullPath, fixedTimestamp, fixedTimestamp)
    }
    await fs.utimes(current, fixedTimestamp, fixedTimestamp)
  }
  await visit(directory)
}

function integrityMatches(bytes: Buffer, integrity: string): boolean {
  const [algorithm, encoded] = integrity.split('-', 2)
  if (algorithm !== 'sha512' || !encoded) {
    return false
  }
  return createHash('sha512').update(bytes).digest('base64') === encoded
}

export function sha512IntegrityHex(integrity: string): string | undefined {
  const [algorithm, encoded, extra] = integrity.split('-')
  if (algorithm !== 'sha512' || !encoded || extra !== undefined) {
    return undefined
  }
  const digest = Buffer.from(encoded, 'base64')
  if (digest.length !== 64 || digest.toString('base64') !== encoded) {
    return undefined
  }
  return digest.toString('hex')
}

export function findNodeArchiveSha256(
  sums: string,
  archive: string,
): string | undefined {
  const matches = sums.split(/\r?\n/).flatMap(line => {
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line)
    return match?.[2] === archive ? [match[1]!.toLowerCase()] : []
  })
  return matches.length === 1 ? matches[0] : undefined
}

export function findLockedPackageIntegrity(
  lock: string,
  packageName: string,
  version: string,
): string | undefined {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = lock.match(
    new RegExp(
      `^  '${escapedName}@${escapedVersion}':\\r?\\n    resolution: \\{integrity: (sha512-[^}]+)\\}`,
      'm',
    ),
  )
  return match?.[1]
}

function readTarEntries(
  archive: Buffer,
  binaryEntry: string,
): Map<string, Buffer> {
  const tar = gunzipSync(archive)
  const files = new Map<string, Buffer>()
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) {
      break
    }
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header
      .subarray(345, 500)
      .toString('utf8')
      .replace(/\0.*$/, '')
    const entryName = prefix ? `${prefix}/${name}` : name
    const type = header[156]
    if (type !== 0 && type !== 48) {
      throw new Error(`Unsupported socket-patch tar entry type at ${entryName}`)
    }
    const sizeText = header
      .subarray(124, 136)
      .toString('ascii')
      .replace(/\0.*$/, '')
      .trim()
    if (!/^[0-7]+$/.test(sizeText)) {
      throw new Error(`Malformed socket-patch tar entry size at ${entryName}`)
    }
    const size = Number.parseInt(sizeText, 8)
    const checksumText = header
      .subarray(148, 156)
      .toString('ascii')
      .replace(/\0.*$/, '')
      .trim()
    const expectedChecksum = Number.parseInt(checksumText, 8)
    let checksum = 0
    for (let index = 0; index < 512; index += 1) {
      checksum += index >= 148 && index < 156 ? 32 : header[index]!
    }
    if (!Number.isFinite(expectedChecksum) || checksum !== expectedChecksum) {
      throw new Error(
        `Invalid socket-patch tar header checksum at ${entryName}`,
      )
    }
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > tar.length) {
      throw new Error(`Truncated socket-patch tar entry at ${entryName}`)
    }
    if (entryName !== binaryEntry && entryName !== 'package/package.json') {
      throw new Error(`Unexpected socket-patch tar entry: ${entryName}`)
    }
    if (files.has(entryName)) {
      throw new Error(`Duplicate socket-patch tar entry: ${entryName}`)
    }
    files.set(entryName, Buffer.from(tar.subarray(dataStart, dataEnd)))
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  if (!files.has(binaryEntry) || !files.has('package/package.json')) {
    throw new Error(
      'socket-patch package tarball is missing its executable or package metadata',
    )
  }
  return files
}

function validateNativeBinary(
  bytes: Buffer,
  platform: string,
  arch: string,
): void {
  let valid = false
  if (platform === 'darwin') {
    const magic = bytes.readUInt32LE(0)
    const cpu = bytes.readUInt32LE(4)
    valid =
      (magic === 0xfeedfacf || magic === 0xcffaedfe) &&
      ((arch === 'arm64' && (cpu === 0x0100000c || cpu === 0x0c000001)) ||
        (arch === 'x64' && (cpu === 0x01000007 || cpu === 0x07000001)))
  } else if (platform === 'linux') {
    const machine =
      bytes[5] === 2 ? bytes.readUInt16BE(18) : bytes.readUInt16LE(18)
    valid =
      bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
      ((arch === 'arm64' && machine === 183) ||
        (arch === 'x64' && machine === 62))
  } else if (
    platform === 'win32' &&
    bytes.length >= 64 &&
    bytes.toString('ascii', 0, 2) === 'MZ'
  ) {
    const peOffset = bytes.readUInt32LE(0x3c)
    valid =
      peOffset + 6 <= bytes.length &&
      bytes.toString('ascii', peOffset, peOffset + 4) === 'PE\0\0' &&
      ((arch === 'arm64' && bytes.readUInt16LE(peOffset + 4) === 0xaa64) ||
        (arch === 'x64' && bytes.readUInt16LE(peOffset + 4) === 0x8664))
  }
  if (!valid) {
    throw new Error(
      `socket-patch binary does not match target ${platform}-${arch}`,
    )
  }
}

async function stageSocketPatch(
  target: readonly [string, string, string],
  stage: string,
  version: string,
  parentLicense: string,
): Promise<
  | { packageName: string; integrity: string; digest: string; license: string }
  | undefined
> {
  const [platform, arch] = target
  const packagePlatform = platform === 'win32' ? 'win32' : platform
  const packageName = `@socketsecurity/socket-patch-${packagePlatform}-${arch}`
  const lock = await fs.readFile(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const integrity = findLockedPackageIntegrity(lock, packageName, version)
  if (!integrity) {
    return undefined
  }
  const url = `https://registry.npmjs.org/${packageName}/-/${packageName.slice(packageName.lastIndexOf('/') + 1)}-${version}.tgz`
  const digest = sha512IntegrityHex(integrity)
  if (!digest) {
    throw new Error(
      `${packageName}@${version} has an invalid sha512 lockfile integrity value`,
    )
  }
  const tarball = await cachedDownload(
    url,
    {
      algorithm: 'sha512',
      digest,
      maxBytes: MAX_PINNED_ARCHIVE_BYTES,
    },
    () =>
      downloadBytes(url, {
        maxBytes: MAX_PINNED_ARCHIVE_BYTES,
      }),
  )
  if (!integrityMatches(tarball, integrity)) {
    throw new Error(
      `${packageName}@${version} failed pnpm lockfile integrity verification`,
    )
  }
  const executableName =
    platform === 'win32' ? 'socket-patch.exe' : 'socket-patch'
  const binaryEntry = `package/${executableName}`
  const entries = readTarEntries(tarball, binaryEntry)
  const metadata = JSON.parse(
    entries.get('package/package.json')!.toString('utf8'),
  ) as { name?: string; version?: string; license?: string }
  if (metadata.name !== packageName || metadata.version !== version) {
    throw new Error(
      `socket-patch package metadata mismatch for ${packageName}@${version}`,
    )
  }
  if (typeof metadata.license !== 'string' || metadata.license.trim() === '') {
    throw new Error(
      `${packageName}@${version} package metadata does not declare a license`,
    )
  }
  if (metadata.license !== parentLicense) {
    throw new Error(
      `${packageName}@${version} license ${metadata.license} does not match parent package license ${parentLicense}`,
    )
  }
  const binary = entries.get(binaryEntry)!
  validateNativeBinary(binary, platform, arch)
  const payloadDirectory = path.join(stage, 'resources')
  await fs.mkdir(payloadDirectory, { recursive: true })
  await fs.writeFile(path.join(payloadDirectory, executableName), binary, {
    mode: 0o755,
    flag: 'wx',
  })
  await fs.copyFile(
    path.join(HERE, 'licenses/socket-patch-MIT.txt'),
    path.join(payloadDirectory, 'socket-patch-LICENSE.txt'),
  )
  return {
    packageName,
    integrity,
    digest: sha256(binary),
    license: metadata.license,
  }
}

type StagedCdxgenApi = {
  packageName: string
  version: string
  declaredLockIntegrity: string
  license: string
  digest: string
  sourceInventorySha256: string
  sourceModuleCount: number
  noticePackageCount: number
  licenseTextCount: number
  noticeTextCount: number
  obligationCount: number
  noticeDocuments: Array<{ path: string; sha256: string }>
}

async function stageCdxgenApi(
  target: readonly [string, string, string],
  stage: string,
  version: string,
): Promise<StagedCdxgenApi | undefined> {
  // Only darwin-arm64 has been qualified with the Node 27 VFS Worker smoke.
  if (target[0] !== 'darwin' || target[1] !== 'arm64') {
    return undefined
  }

  const packageName = '@cyclonedx/cdxgen'
  const packageRoot = path.join(ROOT, 'node_modules/@cyclonedx/cdxgen')
  const packagePath = path.join(packageRoot, 'package.json')
  if (!existsSync(packagePath)) {
    throw new Error(
      `Pinned ${packageName}@${version} is not installed at ${packagePath}`,
    )
  }
  const metadata = JSON.parse(await fs.readFile(packagePath, 'utf8')) as {
    name?: string
    version?: string
    license?: string
  }
  if (metadata.name !== packageName || metadata.version !== version) {
    throw new Error(
      `Installed cdxgen package metadata does not match ${packageName}@${version}`,
    )
  }
  if (typeof metadata.license !== 'string' || metadata.license.trim() === '') {
    throw new Error(
      `${packageName}@${version} package.json does not declare a license`,
    )
  }

  const lock = await fs.readFile(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const integrity = findLockedPackageIntegrity(lock, packageName, version)
  if (!integrity) {
    throw new Error(
      `pnpm-lock.yaml has no integrity for ${packageName}@${version}`,
    )
  }

  const payloadRoot = path.join(stage, 'tools/cdxgen')
  await fs.mkdir(payloadRoot, { recursive: true })
  await run(
    'pnpm',
    ['exec', 'rollup', '-c', '.config/rollup.cdxgen-sea.config.mjs'],
    {
      SEA_CDXGEN_INPUT: path.join(packageRoot, 'lib/cli/index.js'),
      SEA_CDXGEN_OUTPUT: payloadRoot,
    },
  )
  const entrypoint = path.join(payloadRoot, 'lib/cli/index.js')
  const entryStat = await fs.stat(entrypoint).catch(() => undefined)
  if (!entryStat?.isFile() || entryStat.size === 0) {
    throw new Error('Rollup did not produce the embedded cdxgen API entrypoint')
  }
  const noticeInventoryPath = path.join(payloadRoot, 'THIRD-PARTY-NOTICES.json')
  const noticeInventoryStat = await fs
    .stat(noticeInventoryPath)
    .catch(() => undefined)
  if (!noticeInventoryStat?.isFile() || noticeInventoryStat.size === 0) {
    throw new Error(
      'Rollup did not produce the cdxgen third-party notice inventory',
    )
  }
  const noticeInventory = JSON.parse(
    await fs.readFile(noticeInventoryPath, 'utf8'),
  ) as {
    packages?: Array<{
      licenseFiles?: Array<{ path?: unknown; sha256?: unknown }>
      noticeFiles?: Array<{ path?: unknown; sha256?: unknown }>
    }>
    obligations?: unknown[]
  }
  if (
    !Array.isArray(noticeInventory.packages) ||
    !Array.isArray(noticeInventory.obligations)
  ) {
    throw new Error(
      'The cdxgen third-party notice inventory has an invalid structure',
    )
  }
  const noticeDocuments = noticeInventory.packages
    .flatMap(item => [
      ...(item.licenseFiles ?? []),
      ...(item.noticeFiles ?? []),
    ])
    .filter(
      (item): item is { path: string; sha256: string } =>
        typeof item.path === 'string' && typeof item.sha256 === 'string',
    )
    .map(item => ({ path: item.path, sha256: item.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path))
  const sourceInventoryPath = path.join(
    payloadRoot,
    'ROLLUP-SOURCE-INVENTORY.json',
  )
  const sourceInventoryBytes = await fs
    .readFile(sourceInventoryPath)
    .catch(() => undefined)
  if (!sourceInventoryBytes) {
    throw new Error('Rollup did not produce the cdxgen source hash inventory')
  }
  const sourceInventory = JSON.parse(sourceInventoryBytes.toString('utf8')) as {
    verification?: string
    modules?: unknown[]
  }
  if (
    sourceInventory.verification !== 'unverified' ||
    !Array.isArray(sourceInventory.modules)
  ) {
    throw new Error(
      'The cdxgen source hash inventory has an invalid or unexpectedly verified structure',
    )
  }

  const dataDirectory = path.join(packageRoot, 'data')
  if (!existsSync(dataDirectory)) {
    throw new Error(
      `Required cdxgen data directory is missing: ${dataDirectory}`,
    )
  }
  await fs.cp(dataDirectory, path.join(payloadRoot, 'data'), {
    recursive: true,
  })
  await fs.copyFile(packagePath, path.join(payloadRoot, 'package.json'))
  const licensePath = path.join(packageRoot, 'LICENSE')
  if (!existsSync(licensePath)) {
    throw new Error(`Required cdxgen license file is missing: ${licensePath}`)
  }
  await fs.copyFile(licensePath, path.join(payloadRoot, 'LICENSE'))
  await fs.copyFile(
    path.join(HERE, 'adapters/cdxgen-worker.mjs'),
    path.join(payloadRoot, 'sea-worker.mjs'),
  )
  const workerUtils = path.join(payloadRoot, 'utils')
  await fs.mkdir(workerUtils, { recursive: true })
  await fs.copyFile(
    path.join(ROOT, 'src/utils/is-object-object.mjs'),
    path.join(workerUtils, 'is-object-object.mjs'),
  )
  // Keep a concrete VFS path for cdxgen's plugin-directory override. The
  // marker does not install or expose any plugin executable.
  const pluginsDirectory = path.join(payloadRoot, 'plugins-empty')
  await fs.mkdir(pluginsDirectory, { recursive: true })
  await fs.writeFile(path.join(pluginsDirectory, '.socket-empty'), '')

  // ZIP stores file timestamps, so normalize the complete cdxgen closure to
  // keep its archive representation stable across otherwise identical builds.
  await normalizeTreeTimestamps(payloadRoot)
  const digest = await digestTree(payloadRoot)
  return {
    packageName,
    version,
    declaredLockIntegrity: integrity,
    license: metadata.license,
    digest,
    sourceInventorySha256: sha256(sourceInventoryBytes),
    sourceModuleCount: sourceInventory.modules.length,
    noticePackageCount: noticeInventory.packages.length,
    licenseTextCount: noticeInventory.packages.reduce(
      (count, item) => count + (item.licenseFiles?.length ?? 0),
      0,
    ),
    noticeTextCount: noticeInventory.packages.reduce(
      (count, item) => count + (item.noticeFiles?.length ?? 0),
      0,
    ),
    obligationCount: noticeInventory.obligations.length,
    noticeDocuments,
  }
}

async function pinnedNode(target: string): Promise<{
  executable: string
  licenseFile: string
  temporaryDirectory?: string
}> {
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`
  const platform = target.startsWith('win-') ? 'win' : target.split('-')[0]
  const arch = target.split('-')[1]
  const ext = platform === 'win' ? 'zip' : 'tar.gz'
  const archive = `node-v${NODE_VERSION}-${platform}-${arch}.${ext}`
  const sums = await downloadBytes(`${base}/SHASUMS256.txt`, {
    maxBytes: MAX_NODE_SUMS_BYTES,
  })
  const expected = findNodeArchiveSha256(sums.toString('utf8'), archive)
  if (!expected) {
    throw new Error(
      `Node ${NODE_VERSION} ${target} has no unique valid archive entry in official SHASUMS256.txt`,
    )
  }
  const archiveUrl = `${base}/${archive}`
  const bytes = await cachedDownload(
    archiveUrl,
    {
      algorithm: 'sha256',
      digest: expected,
      maxBytes: MAX_PINNED_ARCHIVE_BYTES,
    },
    () =>
      downloadBytes(archiveUrl, {
        maxBytes: MAX_PINNED_ARCHIVE_BYTES,
      }),
  )
  if (!expected || sha256(bytes) !== expected) {
    throw new Error(
      `Node ${NODE_VERSION} ${target} failed official SHASUMS256.txt verification`,
    )
  }

  // The archive hash is part of the cache identity. Builds never mutate or
  // clean a shared extraction tree; each extracts into an owned temp dir and
  // atomically promotes the complete result. A cache that exists but fails
  // full-tree validation is left untouched; this build uses its own verified
  // extraction instead of racing another process to repair shared state.
  const cache = path.join(
    os.homedir(),
    '.cache/socket-sea/node',
    NODE_VERSION,
    target,
    expected,
  )
  const executableRelative = platform === 'win' ? 'node.exe' : 'bin/node'
  const executable = path.join(cache, executableRelative)

  const cacheParent = path.dirname(cache)
  await fs.mkdir(cacheParent, { recursive: true })
  const owned = await fs.mkdtemp(
    path.join(cacheParent, `.extract-${process.pid}-`),
  )
  let preserveOwned = false
  try {
    const archivePath = path.join(owned, archive)
    await fs.writeFile(archivePath, bytes)
    const extracted = path.join(owned, 'unpacked')
    await fs.mkdir(extracted)
    if (platform === 'win') {
      const ps = `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${extracted.replaceAll("'", "''")}' -Force`
      await run('powershell', ['-NoProfile', '-Command', ps])
      const extractedRoot = path.join(
        extracted,
        `node-v${NODE_VERSION}-win-${arch}`,
      )
      await fs.copyFile(
        path.join(extractedRoot, 'node.exe'),
        path.join(owned, 'node.exe'),
      )
      await fs.copyFile(
        path.join(extractedRoot, 'LICENSE'),
        path.join(owned, 'LICENSE'),
      )
    } else {
      await run('tar', [
        '-xzf',
        archivePath,
        '-C',
        extracted,
        '--strip-components=1',
      ])
      await fs.copyFile(
        path.join(extracted, 'LICENSE'),
        path.join(owned, 'LICENSE'),
      )
      for (const directory of ['bin', 'include', 'lib']) {
        await fs
          .rename(path.join(extracted, directory), path.join(owned, directory))
          .catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error
            }
          })
      }
    }
    await fs.rm(extracted, { recursive: true, force: true })
    await fs.rm(archivePath, { force: true })
    if (!existsSync(path.join(owned, executableRelative))) {
      throw new Error(
        `Verified Node archive did not contain expected executable: ${path.join(owned, executableRelative)}`,
      )
    }
    const nodeLicense = path.join(owned, 'LICENSE')
    if (!(await fs.stat(nodeLicense).catch(() => undefined))?.isFile()) {
      throw new Error(
        'The verified Node archive did not contain its root LICENSE file',
      )
    }

    // Hash the full extracted runtime group against this freshly downloaded
    // and officially verified archive before reusing any warm cache entry.
    const verifiedTree = await digestTree(owned)
    const cachedStat = await fs.lstat(cache).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }
      throw error
    })
    if (cachedStat) {
      if (
        cachedStat.isDirectory() &&
        !cachedStat.isSymbolicLink() &&
        (await digestTree(cache).catch(() => '')) === verifiedTree
      ) {
        return { executable, licenseFile: path.join(cache, 'LICENSE') }
      }
      preserveOwned = true
      return {
        executable: path.join(owned, executableRelative),
        licenseFile: nodeLicense,
        temporaryDirectory: owned,
      }
    }
    try {
      await fs.rename(owned, cache)
    } catch (error) {
      // A concurrent build may have promoted first. Accept it only if its
      // complete runtime tree matches the verified extraction owned here.
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'ENOTEMPTY') {
        throw error
      }
      const concurrentStat = await fs.lstat(cache).catch(() => undefined)
      if (
        concurrentStat?.isDirectory() &&
        !concurrentStat.isSymbolicLink() &&
        (await digestTree(cache).catch(() => '')) === verifiedTree
      ) {
        return { executable, licenseFile: path.join(cache, 'LICENSE') }
      }
      preserveOwned = true
      return {
        executable: path.join(owned, executableRelative),
        licenseFile: nodeLicense,
        temporaryDirectory: owned,
      }
    }
  } finally {
    if (!preserveOwned) {
      await fs.rm(owned, { recursive: true, force: true })
    }
  }
  if (!existsSync(executable)) {
    throw new Error(
      `Verified Node archive did not produce expected executable: ${executable}`,
    )
  }
  return { executable, licenseFile: path.join(cache, 'LICENSE') }
}

async function run(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  cwd = ROOT,
): Promise<void> {
  const { spawn } = await import('node:child_process')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    child.once('error', reject)
    child.once('close', code =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    )
  })
}

function parseArgs(): {
  platform?: string
  arch?: string
  outputDir: string
  prototype: boolean
} {
  const result: {
    platform?: string
    arch?: string
    outputDir: string
    prototype: boolean
  } = { outputDir: DEFAULT_OUT, prototype: false }
  for (const arg of process.argv.slice(2)) {
    if (arg === '--') {
      continue
    }
    const [key, ...rest] = arg.replace(/^--/, '').split('=')
    const value = rest.join('=')
    if (key === 'prototype' && value === '') {
      result.prototype = true
    } else if (key === 'platform') {
      result.platform = value
    } else if (key === 'arch') {
      result.arch = value
    } else if (key === 'output-dir') {
      result.outputDir = path.resolve(value)
    } else if (key === 'node-version') {
      if (value !== NODE_VERSION) {
        throw new Error(`Node version is pinned to ${NODE_VERSION}`)
      }
    } else {
      throw new Error(`Unknown build option: ${arg}`)
    }
  }
  return result
}

async function main(): Promise<void> {
  const options = parseArgs()
  if (!options.prototype) {
    throw new Error(
      'This is an experimental core-only prototype, not a release builder. Pass --prototype explicitly.',
    )
  }
  const target = TARGETS.find(
    ([platform, arch]) =>
      (options.platform ?? process.platform) === platform &&
      (options.arch ?? process.arch) === arch,
  )
  if (!target) {
    throw new Error(
      'No matching supported target; pass --platform and --arch explicitly for cross builds',
    )
  }
  const [, , triple] = target
  if (target[0] !== process.platform || target[1] !== process.arch) {
    throw new Error(
      `SEA prototype builds require a native host (${process.platform}-${process.arch}); requested ${triple}`,
    )
  }
  const packageJson = JSON.parse(
    await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'),
  ) as {
    version?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const socketPatchVersion =
    packageJson.dependencies?.['@socketsecurity/socket-patch']
  if (
    !socketPatchVersion ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      socketPatchVersion,
    )
  ) {
    throw new Error(
      '@socketsecurity/socket-patch must have an exact semver version in package.json to build the SEA payload',
    )
  }
  const socketPatchPackage = JSON.parse(
    await fs.readFile(
      path.join(ROOT, 'node_modules/@socketsecurity/socket-patch/package.json'),
      'utf8',
    ),
  ) as {
    name?: string
    version?: string
    license?: string
  }
  if (
    socketPatchPackage.name !== '@socketsecurity/socket-patch' ||
    socketPatchPackage.version !== socketPatchVersion
  ) {
    throw new Error(
      `Installed @socketsecurity/socket-patch metadata does not match pinned version ${socketPatchVersion}`,
    )
  }
  const socketPatchLicense = socketPatchPackage.license
  if (
    typeof socketPatchLicense !== 'string' ||
    socketPatchLicense.trim() === ''
  ) {
    throw new Error(
      `Pinned @socketsecurity/socket-patch@${socketPatchVersion} package.json does not declare a license`,
    )
  }
  const out = path.resolve(options.outputDir)
  await fs.mkdir(out, { recursive: true })
  const releaseOutputLock = await acquireBuildLock(
    path.join(out, '.socket-sea.lock'),
  )
  let releaseDotnetLock: (() => Promise<void>) | undefined
  try {
    releaseDotnetLock = await acquireBuildLock(
      path.join(ROOT, '.cache/socket-sea-dotnet.lock'),
    )
  } catch (error) {
    await releaseOutputLock()
    throw error
  }
  let nodeRuntime: Awaited<ReturnType<typeof pinnedNode>> | undefined
  let node = ''
  let stageDirectory: string | undefined
  try {
    node = (nodeRuntime = await pinnedNode(triple)).executable
    const stage = (stageDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), `socket-sea-${process.pid}-`),
    ))
    const stageDist = path.join(stage, 'dist')
    const stageExternal = path.join(stage, 'external')
    await fs.mkdir(stageDist, { recursive: true })
    await fs.mkdir(stageExternal, { recursive: true })
    await fs.mkdir(path.join(stage, 'resources'), { recursive: true })

    const cdxgenVersion = packageJson.devDependencies?.['@cyclonedx/cdxgen']
    if (
      !cdxgenVersion ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cdxgenVersion)
    ) {
      throw new Error(
        '@cyclonedx/cdxgen must have an exact version in devDependencies to build the SEA payload',
      )
    }
    const synpVersion = packageJson.devDependencies?.['synp']
    const prepTasks = [
      // The 1.14.x distribution includes this first-party helper. Build it
      // before Rollup copies manifest-scripts into the private distribution.
      // Its runtime still uses the user's .NET SDK; NuGet is build-time only.
      run('pnpm', ['run', 'build:dotnet-tool']),
      stageSocketPatch(target, stage, socketPatchVersion, socketPatchLicense),
      (async () => {
        const cdxgenApi = await stageCdxgenApi(target, stage, cdxgenVersion)
        if (
          cdxgenApi &&
          (!synpVersion ||
            !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(synpVersion))
        ) {
          throw new Error(
            'synp must have an exact version in devDependencies to build the Yarn Classic SEA payload',
          )
        }
        const synpPayload = cdxgenApi
          ? await stageSynp(stage, synpVersion!)
          : undefined
        return { cdxgenApi, synpPayload }
      })(),
      stageUv(stage, target[0], target[1]),
    ] as const
    const prepLabels = [
      '.NET facts helper',
      'socket-patch payload',
      'cdxgen and synp payloads',
      'uv payload',
    ] as const
    const prepResults = await Promise.allSettled(prepTasks)
    const prepErrors = prepResults.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            new Error(`SEA preparation failed: ${prepLabels[index]}`, {
              cause: result.reason,
            }),
          ]
        : [],
    )
    if (prepErrors.length > 0) {
      throw new AggregateError(
        prepErrors,
        'One or more independent SEA payload preparation steps failed',
      )
    }
    const socketPatch = (
      prepResults[1] as PromiseFulfilledResult<
        Awaited<ReturnType<typeof stageSocketPatch>>
      >
    ).value
    const { cdxgenApi, synpPayload } = (
      prepResults[2] as PromiseFulfilledResult<{
        cdxgenApi: Awaited<ReturnType<typeof stageCdxgenApi>>
        synpPayload: Awaited<ReturnType<typeof stageSynp>> | undefined
      }>
    ).value
    const uvPayload = (
      prepResults[3] as PromiseFulfilledResult<
        Awaited<ReturnType<typeof stageUv>>
      >
    ).value
    const socketPatchHashFile = socketPatch
      ? path.join(stage, 'resources', 'socket-patch.sha256')
      : undefined
    if (socketPatch && socketPatchHashFile) {
      await fs.writeFile(socketPatchHashFile, `${socketPatch.digest}\n`)
    }

    // Rollup depends on the completed helper and copies it into stageDist.
    // Keep it ordered after preparation, while the independent downloads and
    // helper build above are allowed to overlap.
    await run(
      'pnpm',
      [
        'exec',
        'dotenvx',
        '-q',
        'run',
        '-f',
        '.env.local',
        '--',
        'rollup',
        '-c',
        '.config/rollup.dist.config.mjs',
      ],
      {
        SOCKET_SEA_BUILD: 'true',
        SOCKET_SEA_DIST_DIR: stageDist,
        SOCKET_SEA_EXTERNAL_DIR: stageExternal,
        INLINED_SOCKET_CLI_LEGACY_BUILD: 'false',
        INLINED_SOCKET_CLI_SENTRY_BUILD: 'false',
        INLINED_SOCKET_CLI_PUBLISHED_BUILD: 'true',
      },
    )
    const synpLock = synpPayload
      ? (parseYaml(
          await fs.readFile(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8'),
        ) as {
          packages?: Record<
            string,
            { resolution?: { integrity?: unknown } } | undefined
          >
        })
      : undefined
    const synpLocator = synpPayload ? `synp@${synpPayload.version}` : undefined
    const synpLockIntegrity = synpLocator
      ? synpLock?.packages?.[synpLocator]?.resolution?.integrity
      : undefined
    if (
      synpPayload &&
      (typeof synpLockIntegrity !== 'string' ||
        !synpLockIntegrity.startsWith('sha512-'))
    ) {
      throw new Error(
        `pnpm-lock.yaml has no integrity for synp@${synpPayload.version}`,
      )
    }
    const archive = path.join(stage, 'socket-vfs.zip')
    const bootstrap = path.join(stage, 'bootstrap.cjs')
    const seaConfig = path.join(stage, 'sea-config.json')
    const rootFiles = [
      'package.json',
      'requirements.json',
      'translations.json',
      'LICENSE',
      'node-runtime-LICENSE',
    ]
    for (const filename of rootFiles) {
      const source =
        filename === 'node-runtime-LICENSE'
          ? nodeRuntime.licenseFile
          : path.join(ROOT, filename)
      if (!existsSync(source)) {
        throw new Error(`Required SEA VFS runtime file is missing: ${source}`)
      }
      await fs.copyFile(source, path.join(stage, filename))
    }
    const requiredPayloads = ['dist/cli.js', 'external']
    for (const filename of requiredPayloads) {
      const fullPath = path.join(stage, filename)
      const stat = await fs.stat(fullPath).catch(() => undefined)
      if (
        !stat ||
        (filename === 'dist/cli.js'
          ? !stat.isFile() || stat.size === 0
          : !stat.isDirectory())
      ) {
        throw new Error(
          `Required SEA payload is missing or malformed: ${filename}`,
        )
      }
    }
    const dotnetToolDirectory = path.join(
      stageDist,
      'manifest-scripts/dotnet-tool',
    )
    const dotnetToolEntry = path.join(
      dotnetToolDirectory,
      'socket-facts-dotnet.dll',
    )
    const dotnetToolStat = await fs.stat(dotnetToolEntry).catch(() => undefined)
    if (!dotnetToolStat?.isFile() || dotnetToolStat.size === 0) {
      throw new Error(
        'The .NET facts helper was not copied into the SEA distribution',
      )
    }
    const capabilities = createSeaCapabilities({
      triple,
      hasCdxgen: Boolean(cdxgenApi),
      hasSynp: Boolean(synpPayload),
      hasSocketPatch: Boolean(socketPatch),
      hasUv: Boolean(uvPayload),
      socketPatchVersion,
    })
    await fs.writeFile(
      path.join(stage, 'resources/capabilities.json'),
      `${JSON.stringify(capabilities, null, 2)}\n`,
    )
    // VFS archives and named SEA assets are mutually exclusive in Node 27.
    // Native tools belong in the archive too, then are read from the VFS and
    // materialized only at invocation time.
    const archivePaths = seaArchivePaths({
      hasCdxgen: Boolean(cdxgenApi),
      hasSynp: Boolean(synpPayload),
      hasUv: Boolean(uvPayload),
      rootFiles,
    })
    if (process.platform === 'win32') {
      const quotePowerShell = (value: string) =>
        `'${value.replaceAll("'", "''")}'`
      const sourceList = archivePaths
        .map(filename => quotePowerShell(path.join(stage, filename)))
        .join(', ')
      await run(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Compress-Archive -LiteralPath @(${sourceList}) -DestinationPath ${quotePowerShell(archive)} -Force`,
        ],
        undefined,
        stage,
      )
    } else {
      await run('zip', ['-q', '-r', archive, ...archivePaths], undefined, stage)
    }
    const archiveStat = await fs.stat(archive).catch(() => undefined)
    if (!archiveStat?.isFile() || archiveStat.size === 0) {
      throw new Error('SEA VFS archive was not created or is empty')
    }
    await run(
      'pnpm',
      ['exec', 'rollup', '-c', '.config/rollup.sea.config.mjs'],
      {
        SEA_BOOTSTRAP: path.join(HERE, 'bootstrap.mts'),
        SEA_OUTPUT: bootstrap,
      },
    )

    const config = {
      main: bootstrap,
      output: path.join(
        stage,
        triple.startsWith('win-') ? `socket-${triple}.exe` : `socket-${triple}`,
      ),
      disableExperimentalSEAWarning: true,
      useVfs: true,
      vfsArchive: archive,
      execArgv: ['--no-global-search-paths'],
      execArgvExtension: 'none',
    }
    await fs.writeFile(seaConfig, JSON.stringify(config, null, 2))
    await run(node, ['--build-sea', seaConfig])
    const output = config.output
    if (!triple.startsWith('win-')) {
      await fs.chmod(output, 0o755)
    }
    if (triple.startsWith('darwin-')) {
      await run('codesign', ['--sign', '-', output])
    }

    const appVersion = packageJson.version ?? 'unknown'
    const payloads: Array<Record<string, unknown>> = [
      {
        id: 'node-runtime',
        version: NODE_VERSION,
        file: path.basename(node),
        sha256: await digestFile(node),
        license: 'MIT',
        notices: [
          {
            type: 'license',
            value: 'MIT',
            path: 'node-runtime-LICENSE',
            sha256: await digestFile(path.join(stage, 'node-runtime-LICENSE')),
          },
        ],
      },
      {
        id: 'socket-vfs',
        version: appVersion,
        file: path.basename(output),
        sha256: await digestFile(output),
      },
      {
        id: 'socket-vfs-archive',
        version: appVersion,
        file: 'embedded-vfs-archive',
        sha256: await digestFile(archive),
      },
      {
        id: 'socket-dist',
        version: appVersion,
        file: 'dist/',
        sha256: await digestTree(path.join(stage, 'dist')),
      },
      {
        id: 'socket-dotnet-facts-helper',
        version: appVersion,
        file: 'dist/manifest-scripts/dotnet-tool/',
        sha256: await digestTree(
          path.join(stage, 'dist/manifest-scripts/dotnet-tool'),
        ),
      },
      {
        id: 'external-dependencies',
        version: appVersion,
        file: 'external/',
        sha256: await digestTree(path.join(stage, 'external')),
      },
      ...(await Promise.all(
        rootFiles.map(async filename => ({
          id: `runtime-file:${filename}`,
          version: appVersion,
          file: filename,
          sha256: await digestFile(path.join(stage, filename)),
        })),
      )),
    ]
    if (socketPatch) {
      payloads.push({
        id: 'socket-patch',
        version: socketPatchVersion,
        package: socketPatch.packageName,
        integrity: socketPatch.integrity,
        license: socketPatch.license,
        notices: [
          {
            type: 'license',
            value: socketPatch.license,
            path: 'resources/socket-patch-LICENSE.txt',
          },
        ],
        file: `SEA asset: socket-patch`,
        source: `resources/${triple.startsWith('win-') ? 'socket-patch.exe' : 'socket-patch'}`,
        digestFile: 'resources/socket-patch.sha256',
        sha256: socketPatch.digest,
      })
    }
    if (cdxgenApi) {
      payloads.push({
        id: 'cdxgen-api',
        version: cdxgenApi.version,
        package: cdxgenApi.packageName,
        declaredLockIntegrity: cdxgenApi.declaredLockIntegrity,
        sourceVerification: 'unverified',
        sourceVerificationReason:
          'The frozen lockfile SRI is recorded as declared metadata. Installed Rollup module hashes are provided separately and are not authenticated against the locked tarballs or generated bundle bytes.',
        sourceInventory: {
          file: 'tools/cdxgen/ROLLUP-SOURCE-INVENTORY.json',
          sha256: cdxgenApi.sourceInventorySha256,
          moduleCount: cdxgenApi.sourceModuleCount,
        },
        license: cdxgenApi.license,
        notices: [
          {
            type: 'license',
            value: cdxgenApi.license,
            path: 'tools/cdxgen/LICENSE',
          },
          {
            type: 'third-party-notice-inventory',
            path: 'tools/cdxgen/THIRD-PARTY-NOTICES.json',
          },
        ],
        thirdPartyNotices: {
          inventory: 'tools/cdxgen/THIRD-PARTY-NOTICES.json',
          documents: cdxgenApi.noticeDocuments,
          packageCount: cdxgenApi.noticePackageCount,
          licenseTextCount: cdxgenApi.licenseTextCount,
          noticeTextCount: cdxgenApi.noticeTextCount,
          flaggedObligationCount: cdxgenApi.obligationCount,
        },
        file: 'tools/cdxgen/',
        entrypoint: 'tools/cdxgen/sea-worker.mjs',
        sha256: cdxgenApi.digest,
      })
    }
    if (synpPayload && typeof synpLockIntegrity === 'string') {
      payloads.push({
        id: 'synp-api',
        version: synpPayload.version,
        package: synpPayload.packageName,
        declaredLockIntegrity: synpLockIntegrity,
        sourceVerification: 'unverified',
        sourceVerificationReason:
          'The frozen lockfile SRI and staged payload digest are recorded. No per-module source inventory is emitted, and neither value authenticates installed or transformed source bytes against the locked tarball.',
        license: synpPayload.license,
        notices: [
          {
            type: 'license',
            value: synpPayload.license,
            path: 'tools/synp/LICENSE',
          },
          {
            type: 'third-party-notice-inventory',
            path: 'tools/synp/THIRD-PARTY-NOTICES.json',
          },
        ],
        thirdPartyNotices: {
          inventory: 'tools/synp/THIRD-PARTY-NOTICES.json',
          inventorySha256: synpPayload.noticeInventorySha256,
          documents: synpPayload.noticeDocuments,
          packageCount: synpPayload.noticePackageCount,
          flaggedObligationCount: synpPayload.obligationCount,
        },
        file: 'tools/synp/',
        entrypoint: 'tools/synp/bin/synp.js',
        sha256: synpPayload.integrity,
      })
    }
    if (uvPayload) {
      payloads.push({
        id: 'uv',
        package: uvPayload.packageName,
        version: uvPayload.version,
        target: uvPayload.target,
        source: uvPayload.sourceUrl,
        archiveSha256: uvPayload.declaredArchiveSha256,
        binary: uvPayload.binaryPath,
        sha256: uvPayload.binarySha256,
        size: uvPayload.binarySize,
        license: uvPayload.license,
        notices: uvPayload.noticeDocuments,
        noticeInventory: {
          path: uvPayload.noticeInventoryPath,
          sha256: uvPayload.noticeInventorySha256,
        },
        noticeObligations: uvPayload.noticeObligations,
      })
    }
    const manifest = {
      schemaVersion: 1,
      target: { os: target[0], arch: target[1], triple },
      application: { name: 'socket', version: appVersion },
      payloads,
      thirdPartyNotices: {
        rootDistribution: await listThirdPartyArtifacts(
          path.join(stage, 'dist'),
          'dist',
        ),
        externalDependencies: await listThirdPartyArtifacts(
          path.join(stage, 'external'),
          'external',
        ),
      },
      runtimeRequirements: [
        {
          capability: 'manifest-dotnet-facts',
          executable: 'dotnet',
          resolution: 'socket manifest dotnet --bin or PATH',
          requirement:
            'A .NET SDK compatible with the selected project; the Socket facts helper DLL is embedded, but the SDK/runtime is user-provided.',
        },
      ],
      capabilities,
    }
    const manifestStage = path.join(stage, 'artifact.manifest.json')
    await fs.writeFile(manifestStage, `${JSON.stringify(manifest, null, 2)}\n`)
    await publishArtifactPair({
      stagedBinary: output,
      stagedManifest: manifestStage,
      outputBinary: path.join(out, path.basename(output)),
      outputManifest: path.join(out, `socket-${triple}.manifest.json`),
      transactionDirectory: path.join(
        out,
        `.socket-sea-publish-${randomUUID()}`,
      ),
    })
    console.log(
      `Built ${path.join(out, path.basename(output))} with Node v${NODE_VERSION} (${triple})`,
    )
  } finally {
    try {
      if (stageDirectory) {
        await fs.rm(stageDirectory, { recursive: true, force: true })
      }
      if (nodeRuntime?.temporaryDirectory) {
        await fs.rm(nodeRuntime.temporaryDirectory, {
          recursive: true,
          force: true,
        })
      }
    } finally {
      try {
        await releaseDotnetLock()
      } finally {
        await releaseOutputLock()
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

export { main, pinnedNode }
