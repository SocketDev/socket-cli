import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { isObject } from '@socketsecurity/lib-stable/objects/predicates'
import { expect, it } from 'vitest'

import { getBinCliPath } from '../../src/constants/paths.mts'
import { spawnSocketCli } from '../utils.mts'

it('generates an npm SBOM from the built CLI and ships parser assets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'socket-sdxgen-'))
  try {
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

    const result = await spawnSocketCli(
      getBinCliPath(),
      ['sbom', directory, '--no-banner'],
      { cwd: directory },
    )
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const document: unknown = JSON.parse(result.stdout)
    expect(document).toEqual(
      expect.objectContaining({
        bomFormat: 'CycloneDX',
        components: expect.arrayContaining([
          expect.objectContaining({
            name: 'example-dependency',
            version: '2.0.0',
          }),
        ]),
      }),
    )

    const distPath = path.dirname(getBinCliPath())
    const wasm = await readFile(path.join(distPath, 'acorn.wasm'))
    expect(WebAssembly.validate(wasm)).toBe(true)
    const require = createRequire(import.meta.url)
    const acorn: unknown = require(path.join(distPath, 'acorn-bindgen.cjs'))
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
      await readFile(
        path.join(distPath, 'parsers', 'gradle', 'dependency-tree.init.gradle'),
        'utf8',
      ),
    ).not.toBe('')
    expect(
      await readFile(path.join(distPath, 'LICENSE.sdxgen'), 'utf8'),
    ).toContain('MIT')
  } finally {
    await safeDelete(directory, { maxRetries: 0 })
  }
})
