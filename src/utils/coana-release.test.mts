/**
 * Unit tests for launching the Coana CLI.
 *
 * Test Coverage:
 * - spawnCoana: runs cli-wrapper.mjs from the cache with the caller's args,
 *   cwd and environment, sets the variables Coana reads, leaves the user's
 *   API token variables out, and surfaces a failing run's output.
 *
 * Testing Approach:
 * A fake cli-wrapper.mjs is installed into a temporary cache with the real
 * coana-cache.mjs, so nothing is mocked. This needs dist/coana-cache.mjs, which
 * the build copies there.
 *
 * Related Files:
 * - utils/coana/release.mts (implementation)
 * - src/vendor/coana-cache.mjs (the cache script)
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { spawn } from './spawn.mts'
import constants, { SOCKET_CLI_API_TOKEN_VARIABLES } from '../constants.mts'
import { spawnCoana } from './coana/release.mts'
import { overrideCachedConfig, resetConfigForTesting } from './config.mts'
import {
  getCliUserAgent,
  getDefaultApiBaseUrl,
  resolveDefaultApiToken,
} from './sdk.mts'

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

  afterEach(() => {
    vi.unstubAllEnvs()
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

      expect(
        Object.entries(env).find(
          ([key]) => key.toLowerCase() === 'npm_package_dependencies_react',
        )?.[1],
      ).toBeUndefined()
      expect(
        Object.entries(env).find(
          ([key]) => key.toLowerCase() === 'npm_config_registry',
        )?.[1],
      ).toBe('https://artifactory.example/npm/')
    } finally {
      delete process.env['npm_package_dependencies_react']
      delete process.env['npm_config_registry']
    }
  })

  it('sets the variables Coana reads', async () => {
    overrideCachedConfig(JSON.stringify({ apiToken: 'socket-cli-token' }))
    try {
      const apiToken = await resolveDefaultApiToken()
      expect(apiToken).toBeTruthy()

      const { env } = await runFake({ repoName: 'repo' })

      expect(env).toMatchObject({
        SOCKET_CALLER_USER_AGENT: getCliUserAgent(),
        SOCKET_CLI_API_BASE_URL: getDefaultApiBaseUrl(),
        SOCKET_CLI_API_TOKEN: apiToken,
        SOCKET_CLI_VERSION: constants.ENV.INLINED_SOCKET_CLI_VERSION,
        SOCKET_ORG_SLUG: 'acme',
        SOCKET_REPO_NAME: 'repo',
      })
    } finally {
      resetConfigForTesting()
    }
  })

  it('applies caller environment overrides without replacing the Socket token', async () => {
    overrideCachedConfig(JSON.stringify({ apiToken: 'socket-cli-token' }))
    try {
      const apiToken = await resolveDefaultApiToken()
      const { env } = await runFake({
        env: {
          SOCKET_CALLER_USER_AGENT: 'custom-caller-agent/1.0.0',
          SOCKET_CLI_API_TOKEN: 'user-token',
        },
      })

      expect(env['SOCKET_CALLER_USER_AGENT']).toBe('custom-caller-agent/1.0.0')
      expect(env['SOCKET_CLI_API_TOKEN']).toBe(apiToken)
    } finally {
      resetConfigForTesting()
    }
  })

  it.for([
    { name: 'names no repository', repoName: undefined },
    {
      name: 'names the default repository',
      repoName: 'socket-default-repository',
    },
  ])(
    "leaves the user's SOCKET_REPO_NAME when socket-cli $name",
    async ({ repoName }) => {
      vi.stubEnv('SOCKET_REPO_NAME', 'users-repo')

      const { env } = await runFake({ repoName })

      expect(env['SOCKET_REPO_NAME']).toBe('users-repo')
    },
  )

  it("doesn't add constants.processEnv to Coana's environment", async () => {
    // Set for every socket-cli process.
    expect(constants.processEnv['SOCKET_CLI_GIT_USER_NAME']).toBeTruthy()

    const { env } = await runFake()

    expect(env['SOCKET_CLI_GIT_USER_NAME']).toBeUndefined()
  })

  // Coana gets the token as SOCKET_CLI_API_TOKEN.
  it.for([
    ...SOCKET_CLI_API_TOKEN_VARIABLES.filter(
      name => name !== 'SOCKET_CLI_API_TOKEN',
    ).map(name => ({ name, value: 'users-token' })),
    { name: 'SOCKET_CLI_CONFIG', value: '{"apiToken":"users-token"}' },
  ])(
    "leaves the user's $name out of Coana's environment",
    async ({ name, value }) => {
      vi.stubEnv(name, value)

      const { env } = await runFake()

      expect(env[name]).toBeUndefined()
    },
  )

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
