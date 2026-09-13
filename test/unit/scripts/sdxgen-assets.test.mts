import path from 'node:path'

import { expect, it } from 'vitest'

import { getSdxgenAssetCopies } from '../../../scripts/repo/cli-build/sdxgen.mts'

it('maps installed sdxgen assets into the CLI distribution', () => {
  expect(
    getSdxgenAssetCopies(
      path.join('/example', 'node_modules', 'sdxgen', 'dist', 'index.js'),
      path.join('/example', 'dist'),
    ),
  ).toEqual([
    [
      path.join(
        '/example',
        'node_modules',
        'sdxgen',
        'dist',
        'acorn-bindgen.cjs',
      ),
      path.join('/example', 'dist', 'acorn-bindgen.cjs'),
    ],
    [
      path.join('/example', 'node_modules', 'sdxgen', 'dist', 'acorn.wasm'),
      path.join('/example', 'dist', 'acorn.wasm'),
    ],
    [
      path.join(
        '/example',
        'node_modules',
        'sdxgen',
        'dist',
        'parsers',
        'gradle',
        'dependency-tree.init.gradle',
      ),
      path.join(
        '/example',
        'dist',
        'parsers',
        'gradle',
        'dependency-tree.init.gradle',
      ),
    ],
    [
      path.join('/example', 'node_modules', 'sdxgen', 'LICENSE'),
      path.join('/example', 'dist', 'LICENSE.sdxgen'),
    ],
  ])
})
