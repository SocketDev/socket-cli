import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { generateArchiveFacts } from './generate-archive-facts.mts'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return c >>> 0
})

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// A zip of stored entries (APPNOTE.TXT 4.3), enough for jar/war/ear fixtures.
function zip(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { 0: name, 1: content } of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, 'latin1')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const centralDir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  const count = Object.keys(entries).length
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(centralDir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDir, end])
}

function pom(groupId: string, artifactId: string, version: string) {
  return {
    [`META-INF/maven/${groupId}/${artifactId}/pom.properties`]: `#Created by Apache Maven 3.9.9\nartifactId=${artifactId}\ngroupId=${groupId}\nversion=${version}\n`,
  }
}

// Runs the bundled archive loader: needs `pnpm run build:archive-loader`, a
// dist build and Java 8+.
describe('generateArchiveFacts with the archive loader', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'socket-archive-e2e-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function generate(fileName: string, archive: Buffer) {
    const archivePath = path.join(dir, fileName)
    await fs.writeFile(archivePath, archive)
    const result = await generateArchiveFacts(archivePath)
    const facts = JSON.parse(await fs.readFile(result.factsPath, 'utf8'))
    return { facts, result }
  }

  it('reads nested archives and pom.properties through java.util', async () => {
    const { facts, result } = await generate(
      'suite-1.0.ear',
      zip({
        ...pom('com.example', 'suite', '1.0'),
        'web-1.0.war': zip({
          ...pom('com.example', 'web', '1.0'),
          'WEB-INF/lib/lib-a-2.0.jar': zip({
            'META-INF/maven/org.a/lib-a/pom.properties':
              '#comment\ngroupId = org.a\nartifactId:lib-\\\n   a\nversion 2.0\n',
          }),
          'WEB-INF/lib/broken-1.0.jar': 'not a zip',
        }),
      }),
    )
    expect(result.factsPath).toBe(
      path.join(dir, 'suite-1.0.ear.socket.facts.json'),
    )
    expect(facts.projects[0]).toMatchObject({ name: 'suite', version: '1.0' })
    expect(facts.components.map((c: { id: string }) => c.id)).toEqual([
      'com.example:web:war:1.0',
      'org.a:lib-a:jar:2.0',
    ])
    expect(result.unreadableArchives).toEqual([
      expect.stringMatching(
        /^suite-1\.0\.ear!\/web-1\.0\.war!\/WEB-INF\/lib\/broken-1\.0\.jar: /,
      ),
    ])
  })

  it('throws for a file that is not a zip archive', async () => {
    await expect(
      generate('broken.jar', Buffer.from('not a zip')),
    ).rejects.toThrow(/Could not read .*broken\.jar as a zip archive/)
  })
})
