import { existsSync } from 'node:fs'
import process from 'node:process'
import { expect, it } from 'vitest'
import {
  buildSchemaArgs,
  createSchemaEnv,
  runSchema,
} from '../../../scripts/mcp-schema.mts'

it('isolates schema discovery from credentials and test-only runtime branches', () => {
  const source = {
    SOCKET_API_TOKEN: 'YOUR_API_TOKEN',
    SOCKET_CLI_CONFIG: '{}',
    VITEST: 'true',
    AWS_SECRET_ACCESS_KEY: 'YOUR_SECRET_ACCESS_KEY',
    GITHUB_TOKEN: 'YOUR_GITHUB_TOKEN',
    PATH: '/untrusted',
  }
  const env = createSchemaEnv(source, '/tmp/schema-fixture')
  expect(env.SOCKET_API_TOKEN).toBeUndefined()
  expect(env.SOCKET_CLI_CONFIG).toBeUndefined()
  expect(env.VITEST).toBeUndefined()
  expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  expect(env.GITHUB_TOKEN).toBeUndefined()
  expect(env.PATH).not.toContain('/untrusted')
  expect(env.HOME).toBe('/tmp/schema-fixture')
  expect(env.USERPROFILE).toBe(env.HOME)
  expect(env.XDG_CONFIG_HOME).toBe(env.HOME)
  expect(env.XDG_CACHE_HOME).toBe(env.HOME)
  expect(env.XDG_DATA_HOME).toBe(env.HOME)
  expect(env.SOCKET_HOME).toBe(env.HOME)
  expect(env.SOCKET_CLI_SKIP_UPDATE_CHECK).toBe('1')
  expect(source.VITEST).toBe('true')
  expect(source.SOCKET_API_TOKEN).toBe('YOUR_API_TOKEN')
})

it('pins the server executable and preserves check/update output arguments', () => {
  const check = buildSchemaArgs('check')
  expect(check.slice(0, 10)).toEqual([
    'check',
    '--command',
    process.execPath,
    '--arg',
    'dist/index.js',
    '--arg',
    'mcp',
    '--arg=--config',
    '--arg',
    '{}',
  ])
  expect(check.slice(-4)).toEqual([
    '--timeout',
    '10000',
    '--against',
    'test/integration/mcp-schema.golden.json',
  ])
  const update = buildSchemaArgs('update')
  expect(update[0]).toBe('introspect')
  expect(update.slice(-3)).toEqual([
    '--json',
    '--out',
    'test/integration/mcp-schema.golden.json',
  ])
})

it.each([undefined, [], ''])(
  'rejects a missing or ambiguous schema executable: %j',
  bin => {
    let executed = false
    expect(() =>
      runSchema('check', {
        findBin: () => bin,
        execute() {
          executed = true
          return { status: 0 }
        },
      }),
    ).toThrow(Error)
    expect(executed).toBe(false)
  },
)

it.each(['check', 'update'] as const)(
  'cleans the private home after %s succeeds',
  mode => {
    let home = ''
    runSchema(mode, {
      findBin: () => '/fixture/mcp-tada',
      execute(bin, args, options) {
        expect(bin).toBe('/fixture/mcp-tada')
        expect(args).toEqual(buildSchemaArgs(mode))
        home = options.env.HOME ?? ''
        expect(existsSync(home)).toBe(true)
        expect(options.env.VITEST).toBeUndefined()
        return { status: 0 }
      },
    })
    expect(home).not.toBe('')
    expect(existsSync(home)).toBe(false)
  },
)

it.each(['throw', 'error', 'exit'] as const)(
  'cleans the private home after spawn %s',
  failure => {
    let home = ''
    const error = new Error('Fixture spawn failure')
    expect(() =>
      runSchema('check', {
        findBin: () => '/fixture/mcp-tada',
        execute(bin, args, options) {
          home = options.env.HOME ?? ''
          if (failure === 'throw') {
            throw error
          }
          return failure === 'error' ? { status: 1, error } : { status: 1 }
        },
      }),
    ).toThrow(Error)
    expect(home).not.toBe('')
    expect(existsSync(home)).toBe(false)
  },
)
