import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  assertSeaSigningHost,
  buildSeaWithCli,
  createSeaEntitlements,
  createSeaEntry,
  createSeaLauncher,
  createSeaManifestEvidence,
  readSeaPackageIdentity,
  signSeaBinaryBeforeHash,
} from '../../../../../scripts/repo/build/sea/build.mts'
import type { SeaSigningReceipt } from '../../../../../scripts/repo/build/sea/sign.mts'

const signingReceipt: SeaSigningReceipt = {
  teamId: 'A1B2C3D4E5',
  verified: true,
  hardenedRuntime: true,
  submissionId: '550e8400-e29b-41d4-a716-446655440000',
  notarizationStatus: 'Accepted',
}

describe('SEA entrypoints', () => {
  it('executes the embedded payload and starts the product', () => {
    const payload = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
    const entry = createSeaEntry(payload)
    expect(entry.includes(payload)).toBe(false)
    let started = false
    let filename = ''
    class ProductModule {
      exports = {
        runCliProduct() {
          started = true
        },
      }
      static _nodeModulePaths() {
        return []
      }
      _compile(compiled: string, file: string) {
        expect(compiled).toBe(payload)
        filename = file
      }
    }
    runInNewContext(entry, {
      process: { execPath: '/example/dist/sea/socket-linux-x64', env: {} },
      require(name: string) {
        return name === 'node:module'
          ? { Module: ProductModule }
          : {
              resolve: (...parts: string[]) => parts.join('/'),
              dirname: () => '/example/dist/sea',
            }
      },
    })
    expect(started).toBe(true)
    expect(filename).toContain('cli.js')
  })
  it('forwards arguments, environment, and exit status to the executable', () => {
    let args: unknown[] = []
    const process = {
      platform: 'darwin',
      arch: 'arm64',
      argv: ['node', 'socket', '--help'],
      env: { SOCKET_CLI_MODE: 'npm' },
      exitCode: 0,
    }
    runInNewContext(createSeaLauncher(), {
      __dirname: '/example/dist',
      process,
      require(name: string) {
        return name === 'node:path'
          ? { join: (...parts: string[]) => parts.join('/') }
          : {
              spawnSync(...values: unknown[]) {
                args = values
                return { status: 7 }
              },
            }
      },
    })
    expect(args[0]).toBe('/example/dist/sea/socket-darwin-arm64')
    expect(args[1]).toEqual(['--help'])
    expect(args[2]).toEqual({ stdio: 'inherit', env: process.env })
    expect(process.exitCode).toBe(7)
  })
})

describe('SEA signing build step', () => {
  it('reads package identity for the native release manifest', async () => {
    await expect(readSeaPackageIdentity()).resolves.toEqual({
      packageName: 'socket',
      packageVersion: expect.any(String),
    })
  })

  it.each([
    { args: [], mode: 'development' },
    { args: ['--mode=development'], mode: 'development' },
    { args: ['--mode=production'], mode: 'production' },
  ])(
    'builds CLI before native artifacts in $mode mode',
    async ({ args, mode }) => {
      const operations: string[] = []
      await buildSeaWithCli({
        args,
        buildCli: async selected => {
          operations.push(`cli:${selected}`)
        },
        buildNative: async selected => {
          operations.push(`native:${selected}`)
        },
      })
      expect(operations).toEqual([`cli:${mode}`, `native:${mode}`])
    },
  )

  it('rejects an invalid mode before building', async () => {
    const buildCli = vi.fn(async () => {})
    const buildNative = vi.fn(async () => {})
    await expect(
      buildSeaWithCli({
        args: ['--mode=testing'],
        buildCli,
        buildNative,
      }),
    ).rejects.toThrow('must be development or production')
    expect(buildCli).not.toHaveBeenCalled()
    expect(buildNative).not.toHaveBeenCalled()
  })

  it('stops after CLI build failure before native artifact work', async () => {
    const buildNative = vi.fn(async () => {})
    await expect(
      buildSeaWithCli({
        args: [],
        buildCli: async () => {
          throw new Error('CLI build failed')
        },
        buildNative,
      }),
    ).rejects.toThrow('CLI build failed')
    expect(buildNative).not.toHaveBeenCalled()
  })

  it('signs and notarizes before reading bytes for the receipt digest', async () => {
    const operations: string[] = []
    const result = await signSeaBinaryBeforeHash(
      '/tmp/socket-darwin-arm64',
      async binary => {
        operations.push(`sign:${binary}`)
        return signingReceipt
      },
      {
        readBinary: async binary => {
          operations.push(`read:${binary}`)
          return Buffer.from('signed bytes')
        },
      },
    )
    expect(operations).toEqual([
      'sign:/tmp/socket-darwin-arm64',
      'read:/tmp/socket-darwin-arm64',
    ])
    expect(result).toEqual({
      sha256:
        'd6eade346b42f707c1684aa3d3c029ab0809164b8b878fcccf56fe1d83b3dc1d',
      signing: signingReceipt,
    })
  })

  it('does not read binary bytes after signing fails', async () => {
    const readBinary = vi.fn(async () => Buffer.from('unsigned bytes'))
    await expect(
      signSeaBinaryBeforeHash(
        '/tmp/socket-darwin-arm64',
        async () => {
          throw new Error('signing failed')
        },
        { readBinary },
      ),
    ).rejects.toThrow('signing failed')
    expect(readBinary).not.toHaveBeenCalled()
  })

  it('includes Node JIT entitlements for signed SEA binaries', () => {
    const entitlements = createSeaEntitlements()
    expect(entitlements).toContain('<key>com.apple.security.cs.allow-jit</key>')
    expect(entitlements).toContain(
      '<key>com.apple.security.cs.allow-unsigned-executable-memory</key>',
    )
  })

  it('preserves binary digests and emits signing evidence only for signed Darwin targets', () => {
    const result = createSeaManifestEvidence([
      { target: 'darwin-arm64', sha256: 'arm-digest', signing: signingReceipt },
      { target: 'darwin-x64', sha256: 'x64-digest', signing: signingReceipt },
      { target: 'linux-x64', sha256: 'linux-digest' },
    ])
    expect(result.binaries).toEqual({
      'darwin-arm64': 'arm-digest',
      'darwin-x64': 'x64-digest',
      'linux-x64': 'linux-digest',
    })
    expect(result.darwinSigning).toEqual([
      { ...signingReceipt, target: 'darwin-arm64', sha256: 'arm-digest' },
      { ...signingReceipt, target: 'darwin-x64', sha256: 'x64-digest' },
    ])
  })

  it('emits an empty signing evidence array for unsigned-only targets', () => {
    expect(
      createSeaManifestEvidence([
        { target: 'linux-x64', sha256: 'linux-digest' },
      ]),
    ).toEqual({
      binaries: { 'linux-x64': 'linux-digest' },
      darwinSigning: [],
    })
  })

  it('emits one signing receipt for a partially signed Darwin target set', () => {
    expect(
      createSeaManifestEvidence([
        { target: 'darwin-arm64', sha256: 'arm-digest', signing: signingReceipt },
        { target: 'darwin-x64', sha256: 'x64-digest' },
      ]).darwinSigning,
    ).toEqual([
      { ...signingReceipt, target: 'darwin-arm64', sha256: 'arm-digest' },
    ])
  })

  it('rejects signing evidence for a non-Darwin target', () => {
    expect(() =>
      createSeaManifestEvidence([
        { target: 'linux-x64', sha256: 'linux-digest', signing: signingReceipt },
      ]),
    ).toThrow('requires a Darwin target')
  })

  it('rejects --sign on a non-Darwin build host', () => {
    expect(() =>
      assertSeaSigningHost({ signing: true, platform: 'linux' }),
    ).toThrow('requires a macOS build host')
    expect(() =>
      assertSeaSigningHost({ signing: false, platform: 'linux' }),
    ).not.toThrow()
  })
})
