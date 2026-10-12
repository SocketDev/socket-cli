import { describe, expect, it } from 'vitest'
import { relocateDarwinInitializerOffsets } from '../../../../scripts/repo/build/sea/initializer-offsets.mts'

type FixtureOptions = {
  vmAddress?: bigint
  textRelativeAddress?: bigint
  offsets?: readonly number[]
  textSize?: bigint
  initializerType?: number
  architecture?: number
  signatureSize?: number
  truncate?: boolean
  initializerRelativeAddress?: bigint
  initializerSize?: bigint
  textAddressDelta?: bigint
}

function createMachO(options: FixtureOptions = {}): Buffer {
  const vmAddress = options.vmAddress ?? 0x1_0000_0000n
  const textRelativeAddress = options.textRelativeAddress ?? 0x1000n
  const offsets = options.offsets ?? [0x1004, 0x100c]
  const textSize = options.textSize ?? 32n
  const headerSize = 32
  const segmentSize = 72 + 2 * 80
  const signatureSize = options.signatureSize === undefined ? 0 : 16
  const commandSize = segmentSize + signatureSize
  const textFileOffset = Number(textRelativeAddress)
  const initializerRelativeAddress =
    options.initializerRelativeAddress ?? 0x6000n
  const initializerFileOffset = Number(initializerRelativeAddress)
  const fileSize = Math.max(
    textFileOffset + 64,
    initializerFileOffset + offsets.length * 4 + 64,
  )
  const bytes = Buffer.alloc(fileSize)
  bytes.writeUInt32LE(0xfeedfacf, 0)
  bytes.writeUInt32LE(options.architecture ?? 0x01000007, 4)
  bytes.writeUInt32LE(3, 8)
  bytes.writeUInt32LE(2, 12)
  bytes.writeUInt32LE(options.signatureSize === undefined ? 1 : 2, 16)
  bytes.writeUInt32LE(commandSize, 20)
  bytes.writeUInt32LE(0, 24)
  bytes.writeUInt32LE(0, 28)

  const segment = headerSize
  bytes.writeUInt32LE(0x19, segment)
  bytes.writeUInt32LE(segmentSize, segment + 4)
  bytes.write('__TEXT', segment + 8, 'ascii')
  bytes.writeBigUInt64LE(vmAddress, segment + 24)
  bytes.writeBigUInt64LE(0x10000n, segment + 32)
  bytes.writeBigUInt64LE(0n, segment + 40)
  bytes.writeBigUInt64LE(BigInt(fileSize), segment + 48)
  bytes.writeUInt32LE(7, segment + 56)
  bytes.writeUInt32LE(5, segment + 60)
  bytes.writeUInt32LE(2, segment + 64)

  const textSection = segment + 72
  bytes.write('__text', textSection, 'ascii')
  bytes.write('__TEXT', textSection + 16, 'ascii')
  bytes.writeBigUInt64LE(
    vmAddress + textRelativeAddress + (options.textAddressDelta ?? 0n),
    textSection + 32,
  )
  bytes.writeBigUInt64LE(textSize, textSection + 40)
  bytes.writeUInt32LE(textFileOffset, textSection + 48)
  bytes.writeUInt32LE(0, textSection + 64)

  const initializerSection = textSection + 80
  bytes.write('__init_offsets', initializerSection, 'ascii')
  bytes.write('__TEXT', initializerSection + 16, 'ascii')
  bytes.writeBigUInt64LE(
    vmAddress + initializerRelativeAddress,
    initializerSection + 32,
  )
  bytes.writeBigUInt64LE(
    options.initializerSize ?? BigInt(offsets.length * 4),
    initializerSection + 40,
  )
  bytes.writeUInt32LE(initializerFileOffset, initializerSection + 48)
  bytes.writeUInt32LE(options.initializerType ?? 0x16, initializerSection + 64)
  for (const [index, offset] of offsets.entries()) {
    bytes.writeUInt32LE(offset, initializerFileOffset + index * 4)
  }
  if (options.signatureSize !== undefined) {
    const signature = segment + segmentSize
    bytes.writeUInt32LE(0x1d, signature)
    bytes.writeUInt32LE(signatureSize, signature + 4)
    bytes.writeUInt32LE(fileSize - 64, signature + 8)
    bytes.writeUInt32LE(options.signatureSize, signature + 12)
  }
  return options.truncate
    ? bytes.subarray(0, headerSize + commandSize - 1)
    : bytes
}

function tableValues(bytes: Buffer): number[] {
  const command = 32
  const initializerSection = command + 72 + 80
  const offset = bytes.readUInt32LE(initializerSection + 48)
  const size = Number(bytes.readBigUInt64LE(initializerSection + 40))
  return Array.from({ length: size / 4 }, (_, index) =>
    bytes.readUInt32LE(offset + index * 4),
  )
}

describe('Darwin initializer offset relocation', () => {
  it.each([
    [0x1000n, 0x2000n, 0x1_0000_0000n, 0x3_0000_0000n],
    [0x1800n, 0x3800n, 0x1_2000_0000n, 0x4_0000_0000n],
  ])(
    'maps text positions for base/injected layouts %s and %s',
    (baseText, injectedText, baseVm, injectedVm) => {
      const baseOffsets = [Number(baseText) + 4, Number(baseText) + 12]
      const base = createMachO({
        vmAddress: baseVm,
        textRelativeAddress: baseText,
        offsets: baseOffsets,
      })
      const injected = createMachO({
        vmAddress: injectedVm,
        textRelativeAddress: injectedText,
        offsets: baseOffsets,
      })
      const repaired = relocateDarwinInitializerOffsets(base, injected)
      expect(tableValues(repaired)).toEqual([
        Number(injectedText) + 4,
        Number(injectedText) + 12,
      ])
      expect(tableValues(base)).toEqual(baseOffsets)
      expect(tableValues(injected)).toEqual(baseOffsets)
    },
  )

  it('returns already-corrected tables unchanged and stays idempotent', () => {
    const base = createMachO()
    const injected = createMachO({
      textRelativeAddress: 0x2000n,
      offsets: [0x2004, 0x200c],
    })
    const repaired = relocateDarwinInitializerOffsets(base, injected)
    expect(tableValues(repaired)).toEqual([0x2004, 0x200c])
    expect(relocateDarwinInitializerOffsets(base, repaired)).toBe(repaired)
  })

  it('handles an empty initializer table', () => {
    const injected = createMachO({ offsets: [] })
    expect(
      relocateDarwinInitializerOffsets(createMachO({ offsets: [] }), injected),
    ).toBe(injected)
  })

  it('changes only initializer table bytes', () => {
    const base = createMachO()
    const injected = createMachO({ textRelativeAddress: 0x2000n })
    const repaired = relocateDarwinInitializerOffsets(base, injected)
    const changed = Array.from(repaired.keys()).filter(
      index => repaired[index] !== injected[index],
    )
    const tableStart = injected.readUInt32LE(32 + 72 + 80 + 48)
    expect(
      changed.every(index => index >= tableStart && index < tableStart + 8),
    ).toBe(true)
  })

  it.each([
    ['truncated header', Buffer.alloc(12), createMachO()],
    [
      'bad magic',
      (() => {
        const bytes = createMachO()
        bytes.writeUInt32LE(0, 0)
        return bytes
      })(),
      createMachO(),
    ],
    [
      'wrong architecture',
      createMachO({ architecture: 0x0100000c }),
      createMachO(),
    ],
    [
      'wrong initializer section type',
      createMachO({ initializerType: 0x0b }),
      createMachO(),
    ],
    ['truncated load command', createMachO({ truncate: true }), createMachO()],
    [
      'signed injected image',
      createMachO(),
      createMachO({ signatureSize: 16 }),
    ],
    [
      'section before load commands',
      createMachO({ textRelativeAddress: 32n }),
      createMachO(),
    ],
    [
      'virtual and file offsets disagree',
      createMachO(),
      createMachO({ textAddressDelta: 1n }),
    ],
    [
      'initializer data overlaps text',
      createMachO(),
      createMachO({ initializerRelativeAddress: 0x1010n }),
    ],
    [
      'unsafe 64-bit address',
      createMachO({ vmAddress: BigInt(Number.MAX_SAFE_INTEGER) + 1n }),
      createMachO(),
    ],
  ])('rejects %s', (_name, base, injected) => {
    expect(() => relocateDarwinInitializerOffsets(base, injected)).toThrow()
  })

  it('rejects invalid offsets, mixed tables, and table size mismatches', () => {
    expect(() =>
      relocateDarwinInitializerOffsets(
        createMachO({ offsets: [0x1020] }),
        createMachO({ offsets: [0x1020] }),
      ),
    ).toThrow()
    expect(() =>
      relocateDarwinInitializerOffsets(
        createMachO(),
        createMachO({
          textRelativeAddress: 0x2000n,
          offsets: [0x2004, 0x100c],
        }),
      ),
    ).toThrow()
    expect(() =>
      relocateDarwinInitializerOffsets(
        createMachO(),
        createMachO({ offsets: [0x1004] }),
      ),
    ).toThrow()
    expect(() =>
      relocateDarwinInitializerOffsets(
        createMachO(),
        createMachO({ initializerSize: 10n }),
      ),
    ).toThrow()
    expect(() =>
      relocateDarwinInitializerOffsets(
        createMachO(),
        createMachO({ textSize: 64n }),
      ),
    ).toThrow()
  })
})
