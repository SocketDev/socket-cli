import { execFile as nodeExecFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildNativePackageVerifier } from '../../../../../scripts/repo/build/sea/package/build.mts'

const execFile = promisify(nodeExecFile)

describe('native package verifier bundle', () => {
  it('runs --describe outside the checkout without node_modules', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'socket-native-package-verifier-'),
    )
    try {
      const verifier = await buildNativePackageVerifier({
        outputPath: path.join(directory, 'package-check.generated.mjs'),
      })
      const result = await execFile(
        process.execPath,
        [verifier, '--describe', '--json'],
        {
          cwd: directory,
          timeout: 15_000,
        },
      )
      expect(JSON.parse(result.stdout)).toEqual({
        name: 'native-package-verifier',
        describe: 'verify an installed native package',
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
