import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
/* eslint-disable no-await-in-loop -- Package staging shares a mutable VFS tree. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'

import { downloadBytes } from './download-bytes.mts'
import { cachedDownload } from './download-cache.mts'
import pins from './uv-pins.json' with { type: 'json' }

const UV_VERSION = pins.version
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024

type Platform = 'darwin' | 'linux' | 'win32'
type Architecture = 'arm64' | 'x64'
type Target = `${Platform}-${Architecture}`

type UvTargetPin = {
  archive: string
  sha256: string
  executable: string
  binary: string
}

type UvPins = {
  package: string
  version: string
  license: string
  repository: string
  releaseBaseUrl: string
  licenseBaseUrl: string
  licenseFiles: Array<{ name: string; sha256: string }>
  targets: Record<Target, UvTargetPin>
}

const uvPins = pins as UvPins

export type StagedUv = {
  packageName: string
  version: string
  target: Target
  license: string
  archive: string
  sourceUrl: string
  declaredArchiveSha256: string
  binaryPath: string
  binarySha256: string
  binarySize: number
  licenseFiles: Array<{ path: string; sha256: string; size: number }>
  noticeInventoryPath: string
  noticeInventorySha256: string
  noticeDocuments: Array<{ path: string; sha256: string }>
  noticeObligations: string[]
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function unsupportedTarget(target: string): Error {
  return new Error(
    `Bundled uv is unavailable for ${target}; supported targets are ${Object.keys(uvPins.targets).join(', ')}.`,
  )
}

function targetFor(platform: string, arch: string): Target {
  const target = `${platform}-${arch}`
  if (!Object.hasOwn(uvPins.targets, target)) {
    throw unsupportedTarget(target)
  }
  return target as Target
}

function validateTarPath(name: string, expected: string): void {
  const normalized = name.replace(/\\/g, '/')
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some(part => part === '..')
  ) {
    throw new Error(`uv archive contains an unsafe path: ${name}`)
  }
  if (
    normalized !== expected &&
    normalized !== `${expected.slice(0, expected.lastIndexOf('/') + 1)}` &&
    normalized !== `${expected.slice(0, expected.lastIndexOf('/'))}/uvx`
  ) {
    throw new Error(`uv archive contains an unexpected entry: ${name}`)
  }
}

function readTarExecutable(archive: Buffer, expected: string): Buffer {
  let decompressed: Buffer
  try {
    decompressed = gunzipSync(archive, { maxOutputLength: MAX_EXPANDED_BYTES })
  } catch (error) {
    throw new Error('Pinned uv tarball is not a valid bounded gzip archive', {
      cause: error,
    })
  }

  let offset = 0
  let executable: Buffer | undefined
  while (offset + 512 <= decompressed.length) {
    const header = decompressed.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) {
      break
    }

    const storedChecksum = Number.parseInt(
      header.toString('ascii', 148, 156).trim(),
      8,
    )
    let actualChecksum = 0
    for (let i = 0; i < 512; i += 1) {
      actualChecksum += i >= 148 && i < 156 ? 32 : header[i]!
    }
    if (!Number.isFinite(storedChecksum) || storedChecksum !== actualChecksum) {
      throw new Error(
        'Pinned uv tarball contains an invalid tar header checksum',
      )
    }

    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '')
    const base = header.toString('utf8', 0, 100).replace(/\0.*$/, '')
    const name = prefix ? `${prefix}/${base}` : base
    validateTarPath(name, expected)
    const type = String.fromCharCode(header[156] ?? 0)
    const size = Number.parseInt(header.toString('ascii', 124, 136).trim(), 8)
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_EXPANDED_BYTES) {
      throw new Error(`uv archive entry has an invalid size: ${name}`)
    }
    const contentStart = offset + 512
    const contentEnd = contentStart + size
    if (contentEnd > decompressed.length) {
      throw new Error(`uv archive entry is truncated: ${name}`)
    }
    if (name === expected) {
      if (executable || (type !== '0' && type !== '\0')) {
        throw new Error(
          'uv archive executable is duplicated or is not a regular file',
        )
      }
      executable = Buffer.from(decompressed.subarray(contentStart, contentEnd))
    } else if (
      name !== `${expected.slice(0, expected.lastIndexOf('/'))}/uvx` &&
      type !== '5'
    ) {
      throw new Error(`uv archive contains an unsupported entry type: ${name}`)
    } else if (
      name === `${expected.slice(0, expected.lastIndexOf('/'))}/uvx` &&
      type !== '0' &&
      type !== '\0'
    ) {
      throw new Error(`uv archive uvx entry is not a regular file: ${name}`)
    }
    offset = contentStart + Math.ceil(size / 512) * 512
  }
  if (!executable?.length) {
    throw new Error(
      `Pinned uv tarball is missing its expected executable ${expected}`,
    )
  }
  return executable
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < table.length; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function readZipExecutable(archive: Buffer, expected: string): Buffer {
  const eocdSignature = 0x06054b50
  let eocdOffset = -1
  const minimumOffset = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Pinned uv ZIP has no end-of-directory record')
  }
  const disk = archive.readUInt16LE(eocdOffset + 4)
  const centralDisk = archive.readUInt16LE(eocdOffset + 6)
  const diskEntries = archive.readUInt16LE(eocdOffset + 8)
  const entries = archive.readUInt16LE(eocdOffset + 10)
  const centralSize = archive.readUInt32LE(eocdOffset + 12)
  const centralOffset = archive.readUInt32LE(eocdOffset + 16)
  const commentLength = archive.readUInt16LE(eocdOffset + 20)
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entries ||
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    eocdOffset + 22 + commentLength !== archive.length ||
    centralOffset + centralSize > eocdOffset
  ) {
    throw new Error('Pinned uv ZIP uses an unsupported or malformed ZIP layout')
  }

  let cursor = centralOffset
  let executable: Buffer | undefined
  for (let index = 0; index < entries; index += 1) {
    if (
      cursor + 46 > archive.length ||
      archive.readUInt32LE(cursor) !== 0x02014b50
    ) {
      throw new Error('Pinned uv ZIP has a malformed central directory')
    }
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const expectedCrc = archive.readUInt32LE(cursor + 16)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const entryCommentLength = archive.readUInt16LE(cursor + 32)
    const diskStart = archive.readUInt16LE(cursor + 34)
    const externalAttributes = archive.readUInt32LE(cursor + 38)
    const localOffset = archive.readUInt32LE(cursor + 42)
    const nameStart = cursor + 46
    const name = archive.toString('utf8', nameStart, nameStart + nameLength)
    if (
      !name ||
      name.startsWith('/') ||
      /^[a-zA-Z]:/.test(name) ||
      name
        .replace(/\\/g, '/')
        .split('/')
        .some(part => part === '..')
    ) {
      throw new Error(`uv ZIP contains an unsafe path: ${name}`)
    }
    if (name !== expected && name !== 'uvw.exe' && name !== 'uvx.exe') {
      throw new Error(`uv ZIP contains an unexpected entry: ${name}`)
    }
    if (
      (flags & 1) !== 0 ||
      (method !== 0 && method !== 8) ||
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      uncompressedSize > MAX_EXPANDED_BYTES
    ) {
      throw new Error(`uv ZIP entry uses an unsupported encoding: ${name}`)
    }
    const unixMode = externalAttributes >>> 16
    if ((unixMode & 0xf000) === 0xa000) {
      throw new Error(`uv ZIP contains a symbolic link: ${name}`)
    }
    if ((unixMode & 0xf000) !== 0 && (unixMode & 0xf000) !== 0x8000) {
      throw new Error(`uv ZIP contains a non-regular file: ${name}`)
    }
    if (name === expected) {
      if (executable) {
        throw new Error('uv ZIP executable is duplicated')
      }
      if (
        localOffset + 30 > archive.length ||
        archive.readUInt32LE(localOffset) !== 0x04034b50
      ) {
        throw new Error('uv ZIP executable has a malformed local header')
      }
      const localNameLength = archive.readUInt16LE(localOffset + 26)
      const localExtraLength = archive.readUInt16LE(localOffset + 28)
      const localFlags = archive.readUInt16LE(localOffset + 6)
      const localMethod = archive.readUInt16LE(localOffset + 8)
      const localName = archive.toString(
        'utf8',
        localOffset + 30,
        localOffset + 30 + localNameLength,
      )
      if (
        localName !== name ||
        localFlags !== flags ||
        localMethod !== method
      ) {
        throw new Error('uv ZIP local and central entry headers differ')
      }
      const dataStart = localOffset + 30 + localNameLength + localExtraLength
      const dataEnd = dataStart + compressedSize
      if (dataEnd > centralOffset) {
        throw new Error('uv ZIP executable data is out of bounds')
      }
      const compressed = archive.subarray(dataStart, dataEnd)
      try {
        executable =
          method === 0
            ? Buffer.from(compressed)
            : inflateRawSync(compressed, {
                maxOutputLength: MAX_EXPANDED_BYTES,
              })
      } catch (error) {
        throw new Error('uv ZIP executable could not be decompressed safely', {
          cause: error,
        })
      }
      if (
        executable.length !== uncompressedSize ||
        crc32(executable) !== expectedCrc
      ) {
        throw new Error(
          'uv ZIP executable size or CRC does not match its directory record',
        )
      }
    }
    cursor = nameStart + nameLength + extraLength + entryCommentLength
  }
  if (cursor !== centralOffset + centralSize) {
    throw new Error('Pinned uv ZIP central directory size does not match')
  }
  if (!executable?.length) {
    throw new Error(`Pinned uv ZIP is missing ${expected}`)
  }
  return executable
}

function validateBinary(bytes: Buffer, target: Target): void {
  const [platform, arch] = target.split('-') as [Platform, Architecture]
  let valid = false
  if (
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
  } else if (
    platform === 'linux' &&
    bytes.length >= 20 &&
    bytes[0] === 0x7f &&
    bytes.toString('ascii', 1, 4) === 'ELF'
  ) {
    const machine = bytes.readUInt16LE(18)
    valid =
      (arch === 'arm64' && machine === 183) ||
      (arch === 'x64' && machine === 62)
  } else if (platform === 'darwin' && bytes.length >= 8) {
    const magic = bytes.readUInt32LE(0)
    const cpu = bytes.readUInt32LE(4)
    valid =
      (magic === 0xfeedfacf &&
        ((arch === 'arm64' && cpu === 0x0100000c) ||
          (arch === 'x64' && cpu === 0x01000007))) ||
      (magic === 0xcffaedfe &&
        ((arch === 'arm64' && bytes.readUInt32BE(4) === 0x0100000c) ||
          (arch === 'x64' && bytes.readUInt32BE(4) === 0x01000007)))
  }
  if (!valid) {
    throw new Error(`Downloaded uv executable does not match target ${target}`)
  }
}

function validateUvVersion(filename: string): void {
  let output: string
  try {
    output = execFileSync(filename, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
      windowsHide: true,
      env: { ...process.env, UV_NO_UPDATE_CHECK: '1' },
    })
  } catch (error) {
    throw new Error(
      `Pinned uv ${UV_VERSION} failed its build-time version probe`,
      { cause: error },
    )
  }
  const [command, version] = output.trim().split(/\s+/)
  if (command !== 'uv' || version !== UV_VERSION) {
    throw new Error(
      `Pinned uv version mismatch: expected ${UV_VERSION}, received ${output.trim()}`,
    )
  }
}

/**
 * Fetch and stage the exact upstream uv executable for one native SEA target.
 * Downloads happen only during the build. The runtime receives the extracted,
 * verified executable and does not acquire uv or Python.
 */
export async function stageUv(
  stageRoot: string,
  platform: string = process.platform,
  arch: string = process.arch,
): Promise<StagedUv> {
  if (platform !== process.platform || arch !== process.arch) {
    throw new Error(
      `uv staging requires a native build host (${process.platform}-${process.arch}); requested ${platform}-${arch}.`,
    )
  }
  const target = targetFor(platform, arch)
  const pin = uvPins.targets[target]
  const sourceUrl = `${uvPins.releaseBaseUrl}/${pin.archive}`
  const archive = await cachedDownload(
    sourceUrl,
    {
      algorithm: 'sha256',
      digest: pin.sha256,
      maxBytes: MAX_ARCHIVE_BYTES,
    },
    () =>
      downloadBytes(sourceUrl, {
        acceptedStatuses: [200],
        fetchOptions: { redirect: 'follow' },
        maxBytes: MAX_ARCHIVE_BYTES,
        timeoutMs: 120_000,
      }),
  )
  const actualArchiveSha256 = sha256(archive)
  if (actualArchiveSha256 !== pin.sha256) {
    throw new Error(
      `uv ${UV_VERSION} archive checksum mismatch for ${target}: expected ${pin.sha256}, got ${actualArchiveSha256}`,
    )
  }

  const executable = pin.archive.endsWith('.zip')
    ? readZipExecutable(archive, pin.executable)
    : readTarExecutable(archive, pin.executable)
  validateBinary(executable, target)

  const payloadRoot = path.join(stageRoot, 'tools/uv')
  await fs.rm(payloadRoot, { recursive: true, force: true })
  await fs.mkdir(payloadRoot, { recursive: true })
  const binaryPath = path.join(payloadRoot, pin.binary)
  await fs.writeFile(binaryPath, executable, {
    flag: 'wx',
    mode: 0o755,
  })
  if (platform !== 'win32') {
    await fs.chmod(binaryPath, 0o755)
  }
  validateUvVersion(binaryPath)
  const binaryDigest = sha256(executable)
  await fs.writeFile(path.join(payloadRoot, 'uv.sha256'), `${binaryDigest}\n`, {
    flag: 'wx',
  })

  const licenseFiles: StagedUv['licenseFiles'] = []
  for (const license of uvPins.licenseFiles) {
    const sourceUrl = `${uvPins.licenseBaseUrl}/${license.name}`
    const bytes = await cachedDownload(
      sourceUrl,
      {
        algorithm: 'sha256',
        digest: license.sha256,
        maxBytes: 256 * 1024,
      },
      () =>
        downloadBytes(sourceUrl, {
          acceptedStatuses: [200],
          fetchOptions: { redirect: 'follow' },
          maxBytes: 256 * 1024,
          timeoutMs: 120_000,
        }),
    )
    const digest = sha256(bytes)
    if (digest !== license.sha256) {
      throw new Error(
        `uv ${UV_VERSION} license checksum mismatch for ${license.name}: expected ${license.sha256}, got ${digest}`,
      )
    }
    const destination = path.join(payloadRoot, license.name)
    await fs.writeFile(destination, bytes, { flag: 'wx' })
    licenseFiles.push({
      path: path.relative(stageRoot, destination).split(path.sep).join('/'),
      sha256: digest,
      size: bytes.length,
    })
  }

  // uv is dual-licensed under MIT OR Apache-2.0. Its release archive does not
  // ship a separate transitive-crate notice file. Record that limitation as a
  // review obligation instead of silently claiming a complete notice set.
  const noticeObligations = [
    'The uv release archive has no generated transitive-crate license inventory; review Cargo dependency license notices before qualifying redistribution.',
  ]
  const noticeDocuments = licenseFiles.map(({ path, sha256 }) => ({
    path,
    sha256,
  }))
  const noticeInventory = {
    schemaVersion: 1,
    package: uvPins.package,
    version: UV_VERSION,
    license: uvPins.license,
    source: uvPins.repository,
    sourceTag: UV_VERSION,
    target,
    archive: pin.archive,
    archiveUrl: sourceUrl,
    archiveSha256: actualArchiveSha256,
    licenseDocuments: noticeDocuments,
    obligations: noticeObligations,
  }
  const noticeInventoryPath = path.join(payloadRoot, 'THIRD-PARTY-NOTICES.json')
  const noticeInventoryBytes = Buffer.from(
    `${JSON.stringify(noticeInventory, null, 2)}\n`,
  )
  await fs.writeFile(noticeInventoryPath, noticeInventoryBytes, { flag: 'wx' })

  return {
    packageName: uvPins.package,
    version: UV_VERSION,
    target,
    license: uvPins.license,
    archive: pin.archive,
    sourceUrl,
    declaredArchiveSha256: pin.sha256,
    binaryPath: path.relative(stageRoot, binaryPath).split(path.sep).join('/'),
    binarySha256: binaryDigest,
    binarySize: executable.length,
    licenseFiles,
    noticeInventoryPath: path
      .relative(stageRoot, noticeInventoryPath)
      .split(path.sep)
      .join('/'),
    noticeInventorySha256: sha256(noticeInventoryBytes),
    noticeDocuments,
    noticeObligations,
  }
}
