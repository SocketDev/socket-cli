import { zstdCompressSync } from 'node:zlib'
import { extractWindowsSmolRuntime } from '../../../scripts/repo/cli-build/sea/windows-runtime.mts'
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
      _compile(payload: string, file: string) {
        expect(payload).toBe('example payload')
        filename = file
      }
    }
    runInNewContext(createSeaEntry('example payload'), {
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

describe('Windows node-smol runtime', () => {
  it('extracts a verified PE payload', () => {
    const fixture = createWindowsFixture()
    expect(extractWindowsSmolRuntime(fixture)).toEqual(
      Buffer.from('MZ example node runtime'),
    )
  })
  it('rejects corrupted compressed bytes', () => {
    const fixture = createWindowsFixture()
    fixture[fixture.length - 1] = fixture[fixture.length - 1]! ^ 1
    expect(() => extractWindowsSmolRuntime(fixture)).toThrow()
  })
  it('rejects oversized declared output', () => {
    const fixture = createWindowsFixture()
    fixture.writeBigUInt64LE(512n * 1024n * 1024n, 40)
    expect(() => extractWindowsSmolRuntime(fixture)).toThrow()
  })
  it('rejects truncated metadata', () => {
    expect(() => extractWindowsSmolRuntime(Buffer.alloc(10))).toThrow()
  })
})

function createWindowsFixture(): Buffer {
  const runtime = Buffer.from('MZ example node runtime')
  const compressed = zstdCompressSync(runtime)
  const header = Buffer.alloc(100)
  header.write('__SMOL_PRESSED_DATA_MAGIC_MARKER')
  header.writeBigUInt64LE(BigInt(compressed.length), 32)
  header.writeBigUInt64LE(BigInt(runtime.length), 40)
  createHash('sha256').update(compressed).digest().copy(header, 67)
  return Buffer.concat([header, compressed])
}
