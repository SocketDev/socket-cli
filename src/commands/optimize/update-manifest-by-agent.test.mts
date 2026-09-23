import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readPackageJson } from '@socketsecurity/registry/lib/packages'

import { updateManifest } from './update-manifest-by-agent.mts'
import { NPM, PNPM, YARN_BERRY, YARN_CLASSIC } from '../../constants.mts'

const directories: string[] = []
const overrides = { 'fixture-package': 'npm:fixture-replacement@2.0.0' }
const manifest = {
  name: 'fixture-orchard',
  version: '1.0.0',
  scripts: { test: 'node test.mjs' },
  dependencies: { 'fixture-package': '1.0.0' },
  engines: { node: '>=22' },
  metadata: { preserved: true },
}

async function manifestFixture(content: object) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optimize-manifest-'))
  directories.push(directory)
  const filename = path.join(directory, 'package.json')
  await writeFile(filename, `${JSON.stringify(content, null, 2)}\n`)
  const editable = await readPackageJson(filename, { editable: true })
  return { editable, filename }
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  )
})

describe('optimizer manifest persistence', () => {
  it.each([
    { agent: NPM, field: 'overrides', value: overrides },
    { agent: PNPM, field: 'pnpm', value: { overrides } },
    { agent: YARN_BERRY, field: 'resolutions', value: overrides },
    { agent: YARN_CLASSIC, field: 'resolutions', value: overrides },
  ])(
    'saves $agent overrides in order without changing unrelated fields',
    async ({ agent, field, value }) => {
      const { editable, filename } = await manifestFixture(manifest)
      updateManifest(agent, editable, overrides)
      expect(await editable.save()).toBe(true)
      const saved = await readPackageJson(filename)
      expect(saved).toEqual({ ...manifest, [field]: value })
      expect(Object.keys(saved)).toEqual([
        'name',
        'version',
        'scripts',
        'dependencies',
        field,
        'engines',
        'metadata',
      ])
    },
  )

  it('preserves existing pnpm settings when saving overrides', async () => {
    const original = {
      ...manifest,
      pnpm: { onlyBuiltDependencies: ['fixture-build-tool'] },
    }
    const { editable, filename } = await manifestFixture(original)
    updateManifest(PNPM, editable, overrides)
    expect(await editable.save()).toBe(true)
    const saved = await readPackageJson(filename)
    expect(saved).toEqual({
      ...original,
      pnpm: { ...original.pnpm, overrides },
    })
    expect(Object.keys(saved)).toEqual(Object.keys(original))
  })
})
