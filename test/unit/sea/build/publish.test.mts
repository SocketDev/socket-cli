import { promises as fs } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { publishArtifactPair } from '../../../../src/sea/build/publish.mts'

describe('SEA artifact publication', () => {
  it('preserves an existing binary and manifest when staging the replacement fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sea-publish-test-'))
    const stagedBinary = path.join(directory, 'new-binary')
    const stagedManifest = path.join(directory, 'missing-manifest')
    const outputBinary = path.join(directory, 'socket')
    const outputManifest = path.join(directory, 'socket.manifest.json')
    await writeFile(stagedBinary, 'new executable')
    await writeFile(outputBinary, 'old executable')
    await writeFile(outputManifest, 'old manifest')
    await expect(
      publishArtifactPair({
        stagedBinary,
        stagedManifest,
        outputBinary,
        outputManifest,
        transactionDirectory: path.join(directory, 'transaction'),
      }),
    ).rejects.toThrow()
    await expect(readFile(outputBinary, 'utf8')).resolves.toBe('old executable')
    await expect(readFile(outputManifest, 'utf8')).resolves.toBe('old manifest')
    await rm(directory, { recursive: true, force: true })
  })

  it('rolls back the binary when manifest promotion fails', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'sea-promotion-test-'),
    )
    const stagedBinary = path.join(directory, 'new-binary')
    const stagedManifest = path.join(directory, 'new-manifest')
    const outputBinary = path.join(directory, 'socket')
    const outputManifest = path.join(directory, 'socket.manifest.json')
    const transactionDirectory = path.join(directory, 'transaction')
    await writeFile(stagedBinary, 'new executable')
    await writeFile(stagedManifest, 'new manifest')
    await writeFile(outputBinary, 'old executable')
    await writeFile(outputManifest, 'old manifest')
    let failed = false
    await expect(
      publishArtifactPair({
        stagedBinary,
        stagedManifest,
        outputBinary,
        outputManifest,
        transactionDirectory,
        operations: {
          rename: async (source, destination) => {
            if (destination === outputManifest && !failed) {
              failed = true
              throw new Error('injected manifest promotion failure')
            }
            return await fs.rename(source, destination)
          },
        },
      }),
    ).rejects.toThrow('injected manifest promotion failure')
    await expect(readFile(outputBinary, 'utf8')).resolves.toBe('old executable')
    await expect(readFile(outputManifest, 'utf8')).resolves.toBe('old manifest')
    await rm(directory, { recursive: true, force: true })
  })

  it('keeps a recoverable previous pair when backup cleanup fails after promotion', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sea-backup-test-'))
    const stagedBinary = path.join(directory, 'new-binary')
    const stagedManifest = path.join(directory, 'new-manifest')
    const outputBinary = path.join(directory, 'socket')
    const outputManifest = path.join(directory, 'socket.manifest.json')
    const transactionDirectory = path.join(directory, 'transaction')
    await writeFile(stagedBinary, 'new executable')
    await writeFile(stagedManifest, 'new manifest')
    await writeFile(outputBinary, 'old executable')
    await writeFile(outputManifest, 'old manifest')
    await publishArtifactPair({
      stagedBinary,
      stagedManifest,
      outputBinary,
      outputManifest,
      transactionDirectory,
      operations: {
        rm: async (filename, options) => {
          if (String(filename).includes('.previous')) {
            throw new Error('injected backup cleanup failure')
          }
          return await fs.rm(filename, options)
        },
      },
    })
    await expect(readFile(outputBinary, 'utf8')).resolves.toBe('new executable')
    await expect(readFile(outputManifest, 'utf8')).resolves.toBe('new manifest')
    await expect(readdir(transactionDirectory)).resolves.toEqual(
      expect.arrayContaining([
        'socket.previous',
        'socket.manifest.json.previous',
      ]),
    )
    await rm(directory, { recursive: true, force: true })
  })
})
