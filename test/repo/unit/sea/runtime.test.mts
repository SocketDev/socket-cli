import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import { extractSmolRuntime } from '../../../../scripts/repo/cli-build/sea/runtime.mts'

describe('node-smol runtime', () => {
  it('extracts a verified PE payload', () => {
    const fixture = createSmolFixture()
    expect(extractSmolRuntime(fixture, 'win32-arm64')).toEqual(
      Buffer.from('MZ example node runtime'),
    )
  })
  it.each([
    ['linux-x64', [0x7f, 0x45, 0x4c, 0x46]],
    ['darwin-arm64', [0xcf, 0xfa, 0xed, 0xfe]],
  ] as const)('extracts %s runtime', (target, magic) => {
    const runtime = Buffer.from(magic)
    expect(extractSmolRuntime(createSmolFixture(runtime), target)).toEqual(
      runtime,
    )
  })
  it('rejects corrupted compressed bytes', () => {
    const fixture = createSmolFixture()
    fixture[fixture.length - 1] = fixture[fixture.length - 1]! ^ 1
    expect(() => extractSmolRuntime(fixture, 'win32-arm64')).toThrow()
  })
  it('rejects oversized declared output', () => {
    const fixture = createSmolFixture()
    fixture.writeBigUInt64LE(512n * 1024n * 1024n, 40)
    expect(() => extractSmolRuntime(fixture, 'win32-arm64')).toThrow()
  })
  it('rejects truncated metadata', () => {
    expect(() => extractSmolRuntime(Buffer.alloc(10), 'win32-arm64')).toThrow()
  })
})

function createSmolFixture(
  runtime = Buffer.from('MZ example node runtime'),
): Buffer {
  const compressed = zstdCompressSync(runtime)
  const header = Buffer.alloc(100)
  header.write('__SMOL_PRESSED_DATA_MAGIC_MARKER')
  header.writeBigUInt64LE(BigInt(compressed.length), 32)
  header.writeBigUInt64LE(BigInt(runtime.length), 40)
  createHash('sha256').update(compressed).digest().copy(header, 67)
  return Buffer.concat([header, compressed])
}
