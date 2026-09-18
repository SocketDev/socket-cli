import { zstdCompressSync } from 'node:zlib'
import { extractSmolRuntime } from '../../../scripts/repo/cli-build/sea/runtime.mts'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { verifySeaAsset } from '../../../scripts/repo/cli-build/sea/assets.mts'
import {
  createSeaEntry,
  createSeaLauncher,
} from '../../../scripts/repo/cli-build/sea/build.mts'
import { resolveSeaTarget } from '../../../scripts/repo/cli-build/sea/targets.mts'

describe('SEA package', () => {
  it.each([
    ['darwin', 'arm64', undefined, 'darwin-arm64'],
    ['win32', 'x64', undefined, 'win32-x64'],
    ['linux', 'x64', '2.39', 'linux-x64'],
    ['linux', 'arm64', undefined, 'linux-arm64-musl'],
  ])('selects %s %s', (platform, arch, glibc, expected) => {
    expect(resolveSeaTarget(platform, arch, glibc)).toBe(expected)
  })
  it('rejects unsupported architectures', () => {
    expect(() => resolveSeaTarget('linux', 'riscv64')).toThrow()
  })
  it('verifies download bytes before execution', () => {
    const bytes = Buffer.from('example executable')
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(verifySeaAsset(bytes, digest)).toBe(true)
    expect(verifySeaAsset(Buffer.from('modified executable'), digest)).toBe(
      false,
    )
  })
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
