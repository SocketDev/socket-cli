/**
 * Unit tests for launching the Coana CLI.
 *
 * Test Coverage:
 * - spawnCoana: runs cli-wrapper.mjs from the cache with the caller's args,
 *   cwd and environment, and surfaces a failing run's output.
 *
 * Testing Approach:
 * A fake cli-wrapper.mjs is installed into a temporary cache with the real
 * coana-cache.mjs, so nothing is mocked. This needs dist/coana-cache.mjs, which
 * the build copies there.
 *
 * Related Files:
 * - utils/coana-release.mts (implementation)
 * - vendor/coana-cache.mjs (the cache script)
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants.mts'
import { spawnCoana } from './coana-release.mts'
import { getCliUserAgent } from './sdk.mts'

const VERSION = '1.2.3'

// Prints what it was run with, or fails the way Coana does for some errors.
const FAKE_CLI_WRAPPER = `
const args = process.argv.slice(2)
if (args[0] === 'fail') {
  process.stdout.write('error: Could not resolve 1 dependency(ies)\\n')
  process.exit(1)
}
process.stdout.write(JSON.stringify({ args, cwd: process.cwd(), env: process.env }))
`

type FakeRun = {
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

async function runFake(
  options?: Parameters<typeof spawnCoana>[2],
): Promise<FakeRun> {
  const result = await spawnCoana(['run', '.'], 'acme', {
    coanaVersion: VERSION,
    stdio: 'pipe',
    ...options,
  })
  if (!result.ok) {
    throw new Error(`${result.message}: ${result.cause}`)
  }
  return JSON.parse(result.data) as FakeRun
}

describe('spawnCoana', () => {
  const savedXdgCacheHome = process.env['XDG_CACHE_HOME']
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'socket-coana-release-')),
    )
    process.env['XDG_CACHE_HOME'] = path.join(tmpDir, 'cache')
    const extracted = path.join(tmpDir, 'extracted')
    await fs.mkdir(extracted)
    await fs.writeFile(
      path.join(extracted, 'cli-wrapper.mjs'),
      FAKE_CLI_WRAPPER,
    )
    await spawn(
      'node',
      [
        path.join(constants.distPath, 'coana-cache.mjs'),
        'install',
        VERSION,
        'cli',
        'a'.repeat(64),
        extracted,
      ],
      { stdio: 'pipe' },
    )
  })

  afterAll(async () => {
    if (savedXdgCacheHome === undefined) {
      delete process.env['XDG_CACHE_HOME']
    } else {
      process.env['XDG_CACHE_HOME'] = savedXdgCacheHome
    }
    await fs.rm(tmpDir, { force: true, recursive: true })
  })

  it('runs the cached cli-wrapper.mjs with the args and cwd', async () => {
    const run = await runFake({ cwd: tmpDir })

    expect(run.args).toEqual(['run', '.'])
    expect(run.cwd).toBe(tmpDir)
  })

  it('strips npm_package_* env vars to avoid E2BIG in big monorepos', async () => {
    process.env['npm_package_dependencies_react'] = '^18.2.0'
    // These carry registry and proxy settings from .npmrc.
    process.env['npm_config_registry'] = 'https://artifactory.example/npm/'
    try {
      const { env } = await runFake()

      expect(env['npm_package_dependencies_react']).toBeUndefined()
      expect(env['npm_config_registry']).toBe(
        'https://artifactory.example/npm/',
      )
    } finally {
      delete process.env['npm_package_dependencies_react']
      delete process.env['npm_config_registry']
    }
  })

  it('sets SOCKET_ORG_SLUG and SOCKET_CALLER_USER_AGENT, which options.env overrides', async () => {
    const { env } = await runFake()
    expect(env['SOCKET_ORG_SLUG']).toBe('acme')
    expect(env['SOCKET_CALLER_USER_AGENT']).toBe(getCliUserAgent())

    const overridden = await runFake({
      env: { SOCKET_CALLER_USER_AGENT: 'custom-caller-agent/1.0.0' },
    })
    expect(overridden.env['SOCKET_CALLER_USER_AGENT']).toBe(
      'custom-caller-agent/1.0.0',
    )
  })

  it('surfaces captured stdout when stderr is empty (Coana logs some failures to stdout)', async () => {
    const result = await spawnCoana(['fail'], 'acme', {
      coanaVersion: VERSION,
      stdio: 'pipe',
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Coana command failed (exit code 1)')
    expect(result.message).toContain('Could not resolve 1 dependency(ies)')
  })
})
