import crypto from 'node:crypto'
import { zstdDecompressSync } from 'node:zlib'

const SMOL_MARKER = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER')
const SMOL_METADATA_SIZE = 100
const SMOL_CONFIG_SIZE = 1192
const MAX_RUNTIME_SIZE = 256 * 1024 * 1024

export function extractSmolRuntime(bytes: Buffer, target: string): Buffer {
  const marker = bytes.indexOf(SMOL_MARKER)
  if (marker < 0 || marker + SMOL_METADATA_SIZE > bytes.length) {
    throw new Error(
      'Missing node-smol metadata in base. Verify the pinned asset.',
    )
  }
  const compressedLength = Number(bytes.readBigUInt64LE(marker + 32))
  const runtimeLength = Number(bytes.readBigUInt64LE(marker + 40))
  const hasConfig = bytes[marker + 99]
  const configSize = hasConfig === 1 ? SMOL_CONFIG_SIZE : 0
  const start = marker + SMOL_METADATA_SIZE + configSize
  if (
    (hasConfig !== 0 && hasConfig !== 1) ||
    !isSmolSize(compressedLength) ||
    !isSmolSize(runtimeLength) ||
    start + compressedLength > bytes.length
  ) {
    throw new Error(
      'Invalid node-smol payload bounds. Verify the pinned asset.',
    )
  }
  const compressed = bytes.subarray(start, start + compressedLength)
  const expected = bytes.subarray(marker + 67, marker + 99)
  if (
    !crypto.createHash('sha256').update(compressed).digest().equals(expected)
  ) {
    throw new Error(
      'Corrupt node-smol compressed payload. Verify the pinned asset.',
    )
  }
  const runtime = zstdDecompressSync(compressed, {
    maxOutputLength: runtimeLength,
  })
  if (
    runtime.length !== runtimeLength ||
    !hasSmolRuntimeFormat(runtime, target)
  ) {
    throw new Error(
      'Invalid node-smol runtime. Expected the declared executable format and size.',
    )
  }
  return runtime
}

function isSmolSize(size: number): boolean {
  return Number.isSafeInteger(size) && size > 0 && size <= MAX_RUNTIME_SIZE
}

function hasSmolRuntimeFormat(runtime: Buffer, target: string): boolean {
  if (target.startsWith('win32-')) {
    return runtime.toString('ascii', 0, 2) === 'MZ'
  }
  if (target.startsWith('linux-')) {
    return runtime.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  }
  return runtime.subarray(0, 4).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))
}
