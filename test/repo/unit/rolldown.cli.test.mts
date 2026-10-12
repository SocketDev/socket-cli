import path from 'node:path'

import { describe, expect, it } from 'vitest'
import {
  cliConfig,
  createCliBuildConfig,
  findSocketLibPath,
  ignoreUnsupportedFilesPlugin,
  isSocketLibDistImporter,
} from '../../../.config/repo/cli/rolldown.cli.mts'
import { createBaseConfig } from '../../../scripts/repo/build/rolldown-utils.mts'

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
