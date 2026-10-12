import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cliConfig,
  createCliBuildConfig,
  findSocketLibPath,
  ignoreUnsupportedFilesPlugin,
  isSocketLibDistImporter,
} from '../../../.config/repo/cli/rolldown.cli.mts'
import {
  createBaseConfig,
  parseCliBuildMode,
} from '../../../scripts/repo/build/rolldown-utils.mts'
import { createCliBundleBuildArgs } from '../../../scripts/repo/build/build.mts'
import * as rolldownUtils from '../../../scripts/repo/build/rolldown-utils.mts'
import { runCliRolldownBuild } from '../../../.config/repo/cli/rolldown.build.mts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CLI Rolldown build runner', () => {
  it('uses development mode and keeps CLI post-write transforms', async () => {
    const runBuild = vi
      .spyOn(rolldownUtils, 'runBuild')
      .mockResolvedValue(undefined)

    await runCliRolldownBuild(['--mode=development'])

    expect(runBuild).toHaveBeenCalledTimes(2)
    const [cliConfig, cliOptions] = runBuild.mock.calls[0]!
    expect(cliConfig.transform?.define?.['process.env.NODE_ENV']).toBe(
      '"development"',
    )
    expect(cliOptions).toMatchObject({
      description: 'CLI payload',
      unicodeTransform: true,
    })
    const envVars = cliOptions?.envVars
    expect(envVars).toBeDefined()
    expect(runBuild.mock.calls[1]?.[1]).toEqual({
      description: 'CLI entry point',
      envVars,
    })
  })

  it('rejects invalid modes before invoking Rolldown', async () => {
    const runBuild = vi.spyOn(rolldownUtils, 'runBuild')

    await expect(runCliRolldownBuild(['--mode=invalid'])).rejects.toThrow()
    expect(runBuild).not.toHaveBeenCalled()
  })

  it('rejects when a build step fails', async () => {
    const failure = new Error('example build failure')
    vi.spyOn(rolldownUtils, 'runBuild')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)

    await expect(runCliRolldownBuild([])).rejects.toBe(failure)
  })
})

describe('CLI build mode parsing', () => {
  it.each([
    [[], 'production'],
    [['--mode=development'], 'development'],
    [['--mode', 'development'], 'development'],
    [['--quiet', '--mode=production', '--watch'], 'production'],
  ] as const)('parses %j as %s', (args, expected) => {
    expect(parseCliBuildMode(args)).toBe(expected)
  })

  it('uses the requested default without modifying the argument array', () => {
    const args = ['--quiet']
    expect(parseCliBuildMode(args, { defaultMode: 'development' })).toBe(
      'development',
    )
    expect(args).toEqual(['--quiet'])
  })

  it.each([
    [['--mode']],
    [['--mode=']],
    [['--mode', 'test']],
    [['--mode=development', '--mode=production']],
    [['--mode', 'development', '--mode', 'production']],
  ])('rejects invalid mode arguments %j', args => {
    expect(() => parseCliBuildMode(args)).toThrow()
  })

  it('forwards normalized mode in watch and normal build commands', () => {
    expect(createCliBundleBuildArgs(['--mode', 'development'])).toEqual({
      mode: 'development',
      childArgs: [
        '--max-old-space-size=8192',
        '.config/repo/cli/rolldown.build.mts',
        '--mode=development',
      ],
    })
    expect(createCliBundleBuildArgs(['--watch', '--mode=production'])).toEqual({
      mode: 'production',
      childArgs: [
        '--max-old-space-size=8192',
        '.config/repo/cli/rolldown.cli.mts',
        '--watch',
        '--mode=production',
      ],
    })
  })
})

describe('CLI build configuration', () => {
  it('preserves production defaults', () => {
    const config = createCliBuildConfig()
    expect(config.output).toMatchObject({
      file: path.join(process.cwd(), 'build/cli.js'),
      format: 'cjs',
      minify: false,
      sourcemap: false,
      keepNames: true,
      codeSplitting: false,
    })
    expect(cliConfig.output).toMatchObject({
      file: path.join(process.cwd(), 'build/cli.js'),
    })
    expect(config.transform?.define?.['process.env.NODE_ENV']).toBe(
      '"production"',
    )
  })

  it('sets development mode and requested output path', () => {
    const config = createCliBuildConfig({
      mode: 'development',
      outputPath: '/tmp/cli-dev.js',
    })
    expect(config.output).toMatchObject({ file: '/tmp/cli-dev.js' })
    expect(config.transform?.define?.['process.env.NODE_ENV']).toBe(
      '"development"',
    )
  })

  it('creates independent mutable config and plugin objects', () => {
    const first = createCliBuildConfig()
    const second = createCliBuildConfig()
    expect(first).not.toBe(second)
    expect(first.plugins).not.toBe(second.plugins)
    expect(first.plugins?.[0]).not.toBe(second.plugins?.[0])
    expect(first.transform).not.toBe(second.transform)
    expect(first.transform?.define).not.toBe(second.transform?.define)
    expect(first.output).not.toBe(second.output)
  })

  it('lets an explicit mode override an inlined NODE_ENV value', () => {
    const config = createBaseConfig(
      { NODE_ENV: '"inlined"' },
      { mode: 'development' },
    )
    expect(config.transform?.define?.['process.env.NODE_ENV']).toBe(
      '"development"',
    )
  })
})

describe('SEA library resolution', () => {
  it.each([
    'C:\\workspace\\node_modules\\@socketsecurity\\lib\\dist\\packages\\package.js',
    'C:\\workspace\\node_modules\\@socketsecurity\\lib-stable\\dist\\packages\\package.js',
    '/workspace/node_modules/@socketsecurity/lib/dist/packages/package.js',
  ])('bundles library externals from %s', async importer => {
    expect(isSocketLibDistImporter(importer)).toBe(true)
    expect(findSocketLibPath(importer)).toMatch(
      /@socketsecurity\/lib(?:-stable)?$/,
    )
    const hook = ignoreUnsupportedFilesPlugin().resolveId
    if (typeof hook !== 'function')
      throw new TypeError('Expected a resolver function')
    expect(
      await Reflect.apply(hook, {}, [
        '../external/@npmcli/arborist.js',
        importer,
      ]),
    ).toBeUndefined()
  })
})
