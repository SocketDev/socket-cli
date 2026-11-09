import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { seaArchivePaths } from '../../../src/sea/archive-paths.mts'
import {
  findLockedPackageIntegrity,
  findNodeArchiveSha256,
  parseArgs,
  sha512IntegrityHex,
} from '../../../src/sea/build-sea.mts'
import { createSeaCapabilities } from '../../../src/sea/capabilities.mts'

const execFileAsync = promisify(execFile)
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)

describe('SEA build arguments', () => {
  it('allows the output directory to be set through the environment', () => {
    expect(
      parseArgs([], { SOCKET_CLI_SEA_OUTPUT_DIR: '/tmp/sea-artifacts' })
        .outputDir,
    ).toBe(path.resolve('/tmp/sea-artifacts'))
  })

  it('lets an explicit output-dir argument override the environment', () => {
    expect(
      parseArgs(['--output-dir=/tmp/sea-cli'], {
        SOCKET_CLI_SEA_OUTPUT_DIR: '/tmp/sea-env',
      }).outputDir,
    ).toBe(path.resolve('/tmp/sea-cli'))
  })
})

describe('SEA lockfile metadata', () => {
  it('parses a unique exact Node archive checksum entry', () => {
    const archive = 'node-v27.0.0-alpha.0.0.0-linux-x64.tar.gz'
    const digest = 'a'.repeat(64)
    expect(findNodeArchiveSha256(`${digest}  ${archive}\n`, archive)).toBe(
      digest,
    )
    expect(findNodeArchiveSha256(`${digest}  other-${archive}`, archive)).toBe(
      undefined,
    )
    expect(
      findNodeArchiveSha256(
        `${digest}  ${archive}\n${digest.toUpperCase()} *${archive}`,
        archive,
      ),
    ).toBeUndefined()
  })

  it('converts only canonical sha512 SRI values to cache-key hex', () => {
    const digest = Buffer.alloc(64, 0x42)
    const integrity = `sha512-${digest.toString('base64')}`
    expect(sha512IntegrityHex(integrity)).toBe(digest.toString('hex'))
    expect(sha512IntegrityHex('sha256-deadbeef')).toBeUndefined()
    expect(sha512IntegrityHex('sha512-bad===')).toBeUndefined()
  })

  it('finds the pinned Windows socket-patch integrity in LF and CRLF lockfiles', async () => {
    const lock = (
      await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8')
    ).replace(/\r\n/g, '\n')
    const packageName = '@socketsecurity/socket-patch-win32-x64'
    const integrity = findLockedPackageIntegrity(lock, packageName, '2.0.0')

    expect(integrity).toMatch(/^sha512-/)
    expect(
      findLockedPackageIntegrity(
        lock.replace(/\r?\n/g, '\r\n'),
        packageName,
        '2.0.0',
      ),
    ).toBe(integrity)
    expect(findLockedPackageIntegrity(lock, packageName, '99.99.99')).toBe(
      undefined,
    )
  })
})

describe('SEA capability policy', () => {
  it('keeps optional tools unavailable unless their payloads are present', () => {
    expect(
      createSeaCapabilities({
        triple: 'linux-x64',
        hasCdxgen: false,
        hasSynp: false,
        hasSocketPatch: false,
        hasUv: false,
      }).available,
    ).toEqual(['socket-core', 'manifest-dotnet-facts'])
  })
})

describe('SEA archive paths', () => {
  it('archives staged native tools through their shared tools parent', () => {
    const paths = seaArchivePaths({
      hasCdxgen: true,
      hasSynp: true,
      hasUv: true,
      rootFiles: ['package.json'],
    })
    expect(paths.filter(item => item === 'tools')).toHaveLength(1)
    expect(paths).not.toContain('tools/cdxgen')
    expect(paths).not.toContain('tools/synp')
    expect(paths).not.toContain('tools/uv')
  })

  it.skipIf(process.platform !== 'win32')(
    'keeps nested tools paths in a real Compress-Archive round trip',
    async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'sea-zip-test-'))
      const stage = path.join(directory, 'stage')
      const archive = path.join(directory, 'tools.zip')
      const expanded = path.join(directory, 'expanded')
      const script = path.join(directory, 'archive-fixture.ps1')
      await mkdir(path.join(stage, 'tools/uv'), { recursive: true })
      await writeFile(path.join(stage, 'tools/uv/uv.exe'), 'fixture executable')
      await writeFile(
        script,
        [
          'param([string]$Stage, [string]$Archive, [string]$Expanded)',
          "$ErrorActionPreference = 'Stop'",
          "Compress-Archive -LiteralPath (Join-Path $Stage 'tools') -DestinationPath $Archive -Force",
          'Expand-Archive -LiteralPath $Archive -DestinationPath $Expanded -Force',
          "if (-not (Test-Path (Join-Path $Expanded 'tools/uv/uv.exe'))) { throw 'Nested uv executable was flattened' }",
        ].join('\n'),
      )
      try {
        await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
            stage,
            archive,
            expanded,
          ],
          { timeout: 30_000 },
        )
        expect(
          (await stat(path.join(expanded, 'tools/uv/uv.exe'))).isFile(),
        ).toBe(true)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    30_000,
  )
})

describe('SEA bootstrap Rollup config', () => {
  it('compiles the TypeScript bootstrap through the real Rollup configuration', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'sea-bootstrap-test-'),
    )
    const output = path.join(directory, 'bootstrap.cjs')
    try {
      await execFileAsync(
        process.execPath,
        [
          path.join(root, 'node_modules/rollup/dist/bin/rollup'),
          '-c',
          path.join(root, '.config/rollup.sea.config.mjs'),
          '--file',
          output,
        ],
        { timeout: 30_000 },
      )
      expect((await stat(output)).size).toBeGreaterThan(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
