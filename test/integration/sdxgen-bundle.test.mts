import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { isObject } from '@socketsecurity/lib-stable/objects/predicates'
import { expect, it } from 'vitest'

import { executeSdxgenModule } from '../../src/core/sdxgen/generate.mts'

it('generates an npm manifest from an isolated shipped bundle and retains native parser assets', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'socket-sdxgen-bundle-'),
  )
  try {
    const bundle = path.join(directory, 'bundle')
    await cp(new URL('../../dist/sdxgen/', import.meta.url), bundle, {
      recursive: true,
    })
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'example-project',
        version: '1.0.0',
        dependencies: { 'example-dependency': '2.0.0' },
      }),
    )
    await writeFile(
      path.join(directory, 'package-lock.json'),
      JSON.stringify({
        name: 'example-project',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {
          '': {
            name: 'example-project',
            version: '1.0.0',
            dependencies: { 'example-dependency': '2.0.0' },
          },
          'node_modules/example-dependency': { version: '2.0.0' },
        },
      }),
    )
    const require = createRequire(import.meta.url)
    const module: unknown = require(path.join(bundle, 'index.cjs'))
    const document = await executeSdxgenModule(module, directory)
    expect(document.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'example-dependency',
          version: '2.0.0',
        }),
      ]),
    )
    const wasm = await readFile(path.join(bundle, 'acorn.wasm'))
    expect(WebAssembly.validate(wasm)).toBe(true)
    const acorn: unknown = require(path.join(bundle, 'acorn.cjs'))
    if (!isObject(acorn) || typeof acorn['simple'] !== 'function') {
      throw new TypeError('Missing Acorn visitor API')
    }
    const imports: unknown[] = []
    Reflect.apply(acorn['simple'], undefined, [
      'import dependency from "example-dependency"',
      { ImportDeclaration: (node: unknown) => imports.push(node) },
      { sourceType: 'module', ecmaVersion: 'latest' },
    ])
    expect(imports).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ value: 'example-dependency' }),
      }),
    ])
    expect(
      await readFile(path.join(bundle, 'dependency-tree.init.gradle'), 'utf8'),
    ).toBe(
      await readFile(
        new URL(
          '../../upstream/sdxgen/src/parsers/gradle/dependency-tree.init.gradle',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    expect(
      await readFile(path.join(bundle, 'LICENSE.sdxgen'), 'utf8'),
    ).toContain('MIT')
  } finally {
    await safeDelete(directory, { maxRetries: 0 })
  }
})
