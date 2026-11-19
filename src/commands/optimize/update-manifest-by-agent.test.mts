import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import crossSpawn from 'cross-spawn'
import { afterEach, describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'

import { readPnpmWorkspaceOverrides } from './get-overrides-by-agent.mts'
import {
  updateManifest,
  updatePnpmWorkspaceOverrides,
} from './update-manifest-by-agent.mts'
import {
  NPM,
  PNPM,
  PNPM_LOCK_YAML,
  PNPM_WORKSPACE_YAML,
  YARN_BERRY,
  YARN_CLASSIC,
} from '../../constants.mts'
import { readPackageJson } from '../../utils/packages.mts'

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
  return { directory, editable, filename }
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

  it.each([
    { source: '', comments: [], marker: false },
    { source: '---\n', comments: [], marker: true },
    {
      source: '# Workspace settings\n\n---\n# Keep this comment\n',
      comments: ['# Workspace settings', '# Keep this comment'],
      marker: true,
    },
    {
      source: 'null # Keep this comment\n',
      comments: ['# Keep this comment'],
      marker: false,
    },
  ])(
    'writes overrides to empty pnpm workspace YAML ($source)',
    async ({ comments, marker, source }) => {
      const { directory } = await manifestFixture(manifest)
      const settingsPath = path.join(directory, PNPM_WORKSPACE_YAML)
      await writeFile(settingsPath, source)

      const workspace = await readPnpmWorkspaceOverrides(directory)
      expect(workspace.overrides).toEqual({})
      await updatePnpmWorkspaceOverrides(workspace, overrides)

      const updated = await readFile(settingsPath, 'utf8')
      expect(
        parseAllDocuments(updated).map(document => document.toJS()),
      ).toEqual([{ overrides }])
      expect(/^---$/mu.test(updated)).toBe(marker)
      for (const comment of comments) {
        expect(updated).toContain(comment)
      }
    },
  )

  it('rejects a non-null scalar pnpm workspace root', async () => {
    const { directory } = await manifestFixture(manifest)
    await writeFile(path.join(directory, PNPM_WORKSPACE_YAML), '"null"\n')

    await expect(readPnpmWorkspaceOverrides(directory)).rejects.toThrow(
      'Expected a YAML mapping',
    )
  })

  it('writes modern pnpm overrides that resolve a transitive package offline', async () => {
    const { directory } = await manifestFixture({
      ...manifest,
      dependencies: { 'fixture-parent': 'file:./parent' },
    })
    const localPackages = [
      [
        'parent',
        {
          name: 'fixture-parent',
          version: '1.0.0',
          dependencies: { 'fixture-package': '1.0.0' },
        },
      ],
      ['replacement', { name: 'fixture-package', version: '2.0.0' }],
    ] as const
    await Promise.all(
      localPackages.map(async ([folder, content]) => {
        const pkg = path.join(directory, folder)
        await mkdir(pkg)
        await writeFile(path.join(pkg, 'package.json'), JSON.stringify(content))
      }),
    )
    const settingsPath = path.join(directory, PNPM_WORKSPACE_YAML)
    const settings = [
      '# Workspace settings',
      'packages: []',
      'overrides:',
      '  unused-package: 1.0.0 # keep this',
      '',
    ].join('\n')
    await writeFile(settingsPath, settings)
    const workspace = await readPnpmWorkspaceOverrides(directory)
    expect(workspace.overrides).toEqual({ 'unused-package': '1.0.0' })
    await updatePnpmWorkspaceOverrides(workspace, {
      ...workspace.overrides,
      'fixture-package': 'file:./replacement',
    })
    const updatedSource = await readFile(settingsPath, 'utf8')
    expect(updatedSource).toContain(settings)

    const pnpm = process.env['npm_execpath'] ?? PNPM
    const args = [
      'install',
      '--lockfile-only',
      '--no-frozen-lockfile',
      '--offline',
      '--ignore-scripts',
    ]
    const isScript = /\.[cm]?js$/u.test(pnpm)
    const result = crossSpawn.sync(
      isScript ? process.execPath : pnpm,
      isScript ? [pnpm, ...args] : args,
      { cwd: directory, encoding: 'utf8', env: { ...process.env, CI: '1' } },
    )
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)

    const lockfileSource = await readFile(
      path.join(directory, PNPM_LOCK_YAML),
      'utf8',
    )
    const lockfile = parseAllDocuments(lockfileSource).at(-1)?.toJS()
    expect(lockfile).toMatchObject({
      overrides: { 'fixture-package': 'file:./replacement' },
      snapshots: {
        'fixture-parent@file:parent': {
          dependencies: { 'fixture-package': 'file:replacement' },
        },
      },
    })
  })
})
