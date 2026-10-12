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
      expect(JSON.parse(result.stdout)).toMatchObject({
        name: 'package-check.generated.mjs',
        version: '0.0.0',
        description: 'verify an installed native package',
      })

      const help = await execFile(process.execPath, [verifier, '--help'], {
        cwd: directory,
        timeout: 15_000,
      })
      expect(help.stdout).toContain(
        'Usage: node package-check.generated.mjs --package-root PATH --target TARGET [--json]',
      )

      let invalidArgsError:
        | (Error & { code?: number | undefined; stdout?: string | undefined })
        | undefined
      try {
        await execFile(process.execPath, [verifier, '--json'], {
          cwd: directory,
          timeout: 15_000,
        })
      } catch (error) {
        invalidArgsError = error as Error & {
          code?: number | undefined
          stdout?: string | undefined
        }
      }
      expect(invalidArgsError?.code).toBe(1)
      expect(JSON.parse(invalidArgsError?.stdout ?? '{}')).toMatchObject({
        ok: false,
        error: expect.any(String),
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
