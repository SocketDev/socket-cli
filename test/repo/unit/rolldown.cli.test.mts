import { describe, expect, it } from 'vitest'
import {
  findSocketLibPath,
  ignoreUnsupportedFilesPlugin,
  isSocketLibDistImporter,
} from '../../../.config/repo/cli/rolldown.cli.mts'

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
