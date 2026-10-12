import { Buffer } from 'node:buffer'

const MACHO_MAGIC_64 = 0xfe_ed_fa_cf
const CPU_TYPE_X86_64 = 0x01_00_00_07
const MH_EXECUTE = 2
const LC_SEGMENT_64 = 0x19
const LC_CODE_SIGNATURE = 0x1d
const S_INIT_FUNC_OFFSETS = 0x16
const MACH_HEADER_64_SIZE = 32
const SEGMENT_COMMAND_64_SIZE = 72
const SECTION_64_SIZE = 80

type Section = {
  address: number
  size: number
  offset: number
  flags: number
  segmentName: string
  sectionName: string
}

type TextImage = {
  vmAddress: number
  vmSize: number
  fileOffset: number
  fileSize: number
  text: Section
  initializers: Section
}

function readSafeUInt64(bytes: Buffer, offset: number, label: string): number {
  const value = bytes.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `Invalid Mach-O ${label}: value exceeds safe integer range.`,
    )
  }
  return Number(value)
}

function addWithinLimit(
  left: number,
  right: number,
  limit: number,
  label: string,
): number {
  const end = left + right
  if (!Number.isSafeInteger(end) || left < 0 || right < 0 || end > limit) {
    throw new Error(
      `Invalid Mach-O ${label}: range exceeds its containing data.`,
    )
  }
  return end
}

function readName(bytes: Buffer, offset: number): string {
  const field = bytes.subarray(offset, offset + 16)
  const end = field.indexOf(0)
  return field.toString('ascii', 0, end === -1 ? field.length : end)
}

type SegmentInfo = Omit<TextImage, 'text' | 'initializers'> & {
  segmentName: string
  textSections: Section[]
  initializerSections: Section[]
}

function parseSegmentCommand(
  bytes: Buffer,
  cursor: number,
  commandEnd: number,
  label: string,
): SegmentInfo {
  if (commandEnd - cursor < SEGMENT_COMMAND_64_SIZE) {
    throw new Error(`Invalid ${label} Mach-O: truncated segment command.`)
  }
  const segmentName = readName(bytes, cursor + 8)
  const vmAddress = readSafeUInt64(
    bytes,
    cursor + 24,
    `${label} segment address`,
  )
  const vmSize = readSafeUInt64(bytes, cursor + 32, `${label} segment size`)
  const fileOffset = readSafeUInt64(
    bytes,
    cursor + 40,
    `${label} segment file offset`,
  )
  const fileSize = readSafeUInt64(
    bytes,
    cursor + 48,
    `${label} segment file size`,
  )
  addWithinLimit(
    vmAddress,
    vmSize,
    Number.MAX_SAFE_INTEGER,
    `${label} segment virtual range`,
  )
  addWithinLimit(
    fileOffset,
    fileSize,
    bytes.length,
    `${label} segment file range`,
  )
  const sectionCount = bytes.readUInt32LE(cursor + 64)
  const sectionBytes = sectionCount * SECTION_64_SIZE
  if (!Number.isSafeInteger(sectionBytes)) {
    throw new Error(`Invalid ${label} Mach-O: section count overflows.`)
  }
  const sectionsStart = cursor + SEGMENT_COMMAND_64_SIZE
  addWithinLimit(
    sectionsStart,
    sectionBytes,
    commandEnd,
    `${label} section table`,
  )
  const textSections: Section[] = []
  const initializerSections: Section[] = []
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionsStart + index * SECTION_64_SIZE
    const sectionName = readName(bytes, offset)
    const sectionSegmentName = readName(bytes, offset + 16)
    const address = readSafeUInt64(
      bytes,
      offset + 32,
      `${label} section address`,
    )
    const size = readSafeUInt64(bytes, offset + 40, `${label} section size`)
    const sectionFileOffset = bytes.readUInt32LE(offset + 48)
    const flags = bytes.readUInt32LE(offset + 64)
    addWithinLimit(
      address,
      size,
      Number.MAX_SAFE_INTEGER,
      `${label} section virtual range`,
    )
    if (size > 0 && (flags & 0xff) !== 1 && (flags & 0xff) !== 0x0c) {
      addWithinLimit(
        sectionFileOffset,
        size,
        bytes.length,
        `${label} section file range`,
      )
    }
    if (segmentName === '__TEXT' && sectionSegmentName === '__TEXT') {
      const section = {
        address,
        size,
        offset: sectionFileOffset,
        flags,
        segmentName: sectionSegmentName,
        sectionName,
      }
      if (sectionName === '__text') {
        textSections.push(section)
      }
      if (sectionName === '__init_offsets') {
        initializerSections.push(section)
      }
    }
  }
  return {
    segmentName,
    vmAddress,
    vmSize,
    fileOffset,
    fileSize,
    textSections,
    initializerSections,
  }
}

function validateCodeSignature(
  bytes: Buffer,
  cursor: number,
  commandEnd: number,
  label: string,
): void {
  if (commandEnd - cursor < 16) {
    throw new Error(
      `Invalid ${label} Mach-O: truncated code signature command.`,
    )
  }
  const dataOffset = bytes.readUInt32LE(cursor + 8)
  const dataSize = bytes.readUInt32LE(cursor + 12)
  addWithinLimit(
    dataOffset,
    dataSize,
    bytes.length,
    `${label} code signature range`,
  )
  if (label === 'injected' && dataSize > 0) {
    throw new Error(
      'Invalid injected Mach-O: code signature must be repaired before signing.',
    )
  }
}

function validateTextSection(
  section: Section,
  segment: SegmentInfo,
  commandsEnd: number,
  bytes: Buffer,
  label: string,
): void {
  const virtualDelta = section.address - segment.vmAddress
  const fileDelta = section.offset - segment.fileOffset
  if (virtualDelta !== fileDelta) {
    throw new Error(
      `Invalid ${label} Mach-O: section virtual and file offsets disagree.`,
    )
  }
  const segmentEnd = addWithinLimit(
    segment.vmAddress,
    segment.vmSize,
    Number.MAX_SAFE_INTEGER,
    `${label} segment virtual range`,
  )
  if (
    section.address < segment.vmAddress ||
    section.address + section.size > segmentEnd
  ) {
    throw new Error(`Invalid ${label} Mach-O: section is outside __TEXT.`)
  }
  const fileEnd = addWithinLimit(
    segment.fileOffset,
    segment.fileSize,
    bytes.length,
    `${label} segment file range`,
  )
  if (
    section.offset < commandsEnd ||
    section.offset < segment.fileOffset ||
    section.offset + section.size > fileEnd
  ) {
    throw new Error(
      `Invalid ${label} Mach-O: section data is outside __TEXT data.`,
    )
  }
}

function selectTextSections(
  segment: SegmentInfo,
  commandsEnd: number,
  bytes: Buffer,
  label: string,
): Pick<TextImage, 'text' | 'initializers'> {
  if (
    segment.textSections.length !== 1 ||
    segment.initializerSections.length !== 1
  ) {
    throw new Error(
      `Invalid ${label} Mach-O: expected unique __text and __init_offsets sections.`,
    )
  }
  const text = segment.textSections[0]!
  const initializers = segment.initializerSections[0]!
  validateTextSection(text, segment, commandsEnd, bytes, label)
  validateTextSection(initializers, segment, commandsEnd, bytes, label)
  if (
    text.offset + text.size > initializers.offset &&
    initializers.offset + initializers.size > text.offset
  ) {
    throw new Error(
      `Invalid ${label} Mach-O: __text and __init_offsets data overlap.`,
    )
  }
  if ((initializers.flags & 0xff) !== S_INIT_FUNC_OFFSETS) {
    throw new Error(
      `Invalid ${label} Mach-O: __init_offsets has the wrong section type.`,
    )
  }
  return { text, initializers }
}

function parseTextImage(bytes: Buffer, label: string): TextImage {
  if (bytes.length < MACH_HEADER_64_SIZE) {
    throw new Error(`Invalid ${label} Mach-O: truncated 64-bit header.`)
  }
  if (bytes.readUInt32LE(0) !== MACHO_MAGIC_64) {
    throw new Error(
      `Invalid ${label} Mach-O: expected little-endian 64-bit format.`,
    )
  }
  if (
    bytes.readUInt32LE(4) !== CPU_TYPE_X86_64 ||
    bytes.readUInt32LE(12) !== MH_EXECUTE
  ) {
    throw new Error(`Invalid ${label} Mach-O: expected an x86_64 executable.`)
  }
  const commandCount = bytes.readUInt32LE(16)
  const commandBytes = bytes.readUInt32LE(20)
  const commandsEnd = addWithinLimit(
    MACH_HEADER_64_SIZE,
    commandBytes,
    bytes.length,
    `${label} load commands`,
  )
  let cursor = MACH_HEADER_64_SIZE
  const segments: SegmentInfo[] = []
  for (let index = 0; index < commandCount; index += 1) {
    addWithinLimit(cursor, 8, commandsEnd, `${label} load command header`)
    const command = bytes.readUInt32LE(cursor)
    const commandSize = bytes.readUInt32LE(cursor + 4)
    if (commandSize < 8) {
      throw new Error(
        `Invalid ${label} Mach-O: load command size is too small.`,
      )
    }
    const commandEnd = addWithinLimit(
      cursor,
      commandSize,
      commandsEnd,
      `${label} load command`,
    )
    if (command === LC_SEGMENT_64) {
      segments.push(parseSegmentCommand(bytes, cursor, commandEnd, label))
    }
    if (command === LC_CODE_SIGNATURE) {
      validateCodeSignature(bytes, cursor, commandEnd, label)
    }
    cursor = commandEnd
  }
  if (cursor !== commandsEnd) {
    throw new Error(
      `Invalid ${label} Mach-O: load command sizes do not match the header.`,
    )
  }
  const textSegments = segments.filter(
    segment => segment.segmentName === '__TEXT',
  )
  if (textSegments.length !== 1) {
    throw new Error(`Invalid ${label} Mach-O: expected one __TEXT segment.`)
  }
  const segment = textSegments[0]!
  const { text, initializers } = selectTextSections(
    segment,
    commandsEnd,
    bytes,
    label,
  )
  return {
    vmAddress: segment.vmAddress,
    vmSize: segment.vmSize,
    fileOffset: segment.fileOffset,
    fileSize: segment.fileSize,
    text,
    initializers,
  }
}

function mapInitializerOffset(
  offset: number,
  index: number,
  baseImage: TextImage,
  injectedImage: TextImage,
): number {
  const baseAddress = baseImage.vmAddress + offset
  if (!Number.isSafeInteger(baseAddress)) {
    throw new Error(
      `Cannot relocate Darwin initializer ${index}: base address exceeds safe integer range.`,
    )
  }
  const textEnd = baseImage.text.address + baseImage.text.size
  if (baseAddress < baseImage.text.address || baseAddress >= textEnd) {
    throw new Error(
      `Cannot relocate Darwin initializer ${index}: base offset is outside __text.`,
    )
  }
  const textPosition = baseAddress - baseImage.text.address
  const injectedAddress = injectedImage.text.address + textPosition
  if (!Number.isSafeInteger(injectedAddress)) {
    throw new Error(
      `Cannot relocate Darwin initializer ${index}: injected address exceeds safe integer range.`,
    )
  }
  const relocated = injectedAddress - injectedImage.vmAddress
  if (
    !Number.isSafeInteger(relocated) ||
    relocated < 0 ||
    relocated > 0xff_ff_ff_ff
  ) {
    throw new Error(
      `Cannot relocate Darwin initializer ${index}: offset exceeds 32-bit range.`,
    )
  }
  return relocated
}

export function relocateDarwinInitializerOffsets(
  base: Buffer,
  injected: Buffer,
): Buffer {
  const baseImage = parseTextImage(base, 'base')
  const injectedImage = parseTextImage(injected, 'injected')
  if (baseImage.text.size !== injectedImage.text.size) {
    throw new Error('Cannot relocate Darwin initializers: __text sizes differ.')
  }
  if (baseImage.initializers.size !== injectedImage.initializers.size) {
    throw new Error(
      'Cannot relocate Darwin initializers: __init_offsets sizes differ.',
    )
  }
  if (baseImage.initializers.size % 4 !== 0) {
    throw new Error(
      'Cannot relocate Darwin initializers: offset table size is not divisible by four.',
    )
  }

  const repaired = Buffer.from(injected)
  let allOriginal = true
  let allExpected = true
  const count = baseImage.initializers.size / 4
  for (let index = 0; index < count; index += 1) {
    const tableOffset = baseImage.initializers.offset + index * 4
    const baseOffset = base.readUInt32LE(tableOffset)
    const relocated = mapInitializerOffset(
      baseOffset,
      index,
      baseImage,
      injectedImage,
    )
    const injectedOffset = injectedImage.initializers.offset + index * 4
    const current = injected.readUInt32LE(injectedOffset)
    allOriginal &&= current === baseOffset
    allExpected &&= current === relocated
    repaired.writeUInt32LE(relocated, injectedOffset)
  }
  if (allExpected) {
    return injected
  }
  if (!allOriginal) {
    throw new Error(
      'Cannot relocate Darwin initializers: table contains mixed or unrelated offsets.',
    )
  }
  return repaired
}
