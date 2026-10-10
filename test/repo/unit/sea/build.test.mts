import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  createSeaEntry,
  createSeaLauncher,
} from '../../../../scripts/repo/cli-build/sea/build.mts'

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
