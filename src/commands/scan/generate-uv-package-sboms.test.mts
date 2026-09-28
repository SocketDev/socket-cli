import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  generateUvPackageSboms,
  normalizeUvPackageNames,
  resolveUvProjectRoot,
} from './generate-uv-package-sboms.mts'

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }))

vi.mock('@socketsecurity/registry/lib/spawn', () => ({ spawn: mockSpawn }))

const sbom = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { name: 'api', 'bom-ref': 'api' } },
  components: [{ name: 'idna', version: '3.10', 'bom-ref': 'idna' }],
  dependencies: [{ ref: 'api', dependsOn: ['idna'] }],
})

describe('uv package SBOM export', () => {
  let projectRoot: string
  let outputDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    projectRoot = await fs.mkdtemp(path.join(tmpdir(), 'socket-uv-unit-'))
    outputDir = path.join(projectRoot, 'output')
    await fs.writeFile(path.join(projectRoot, 'pyproject.toml'), '')
    await fs.writeFile(path.join(projectRoot, 'uv.lock'), '')
    mockSpawn.mockResolvedValue({ stdout: sbom })
  })

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  it('exports the graph without changing its contents', async () => {
    const paths = await generateUvPackageSboms({
      outputDir,
      packageNames: ['api'],
      projectRoot,
    })
    expect(paths).toEqual([path.join(outputDir, 'socket-api-cdx.json')])
    expect(await fs.readFile(paths[0]!, 'utf8')).toBe(sbom)
    expect(mockSpawn).toHaveBeenCalledWith(
      'uv',
      [
        'export',
        '--project',
        projectRoot,
        '--package',
        'api',
        '--format',
        'cyclonedx1.5',
        '--frozen',
        '--offline',
        '--no-python-downloads',
        '--all-extras',
        '--all-groups',
      ],
      expect.objectContaining({ cwd: projectRoot, stdio: 'pipe' }),
    )
  })

  it('normalizes and deduplicates package names', () => {
    expect(normalizeUvPackageNames(['My_API', 'my.api', 'other'])).toEqual([
      'my-api',
      'other',
    ])
    expect(normalizeUvPackageNames([])).toEqual([])
  })

  it.each([
    '',
    './packages/api',
    '../api',
    '--all-packages',
    'api,worker',
    '*',
    'api/worker',
  ])('rejects invalid package selector %j', value => {
    expect(() => normalizeUvPackageNames([value])).toThrow('project.name')
  })

  it.each([
    'not JSON',
    '{}',
    '{"bomFormat":"CycloneDX","metadata":{"component":{"name":"api"}}}',
    sbom.replace('"name":"api"', '"name":"wrong-root"'),
  ])('rejects an invalid or incorrectly scoped SBOM', async stdout => {
    mockSpawn.mockResolvedValueOnce({ stdout })
    await expect(
      generateUvPackageSboms({ outputDir, packageNames: ['api'], projectRoot }),
    ).rejects.toThrow('dependency graph rooted at "api"')
    await expect(
      fs.stat(path.join(outputDir, 'socket-api-cdx.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    'No workspace member named api',
    'Unsupported lockfile version',
    'uv is not installed',
  ])('reports an export failure: %s', async stderr => {
    mockSpawn.mockRejectedValueOnce(
      Object.assign(new Error('command failed'), { stderr }),
    )
    await expect(
      generateUvPackageSboms({ outputDir, packageNames: ['api'], projectRoot }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Could not export uv package "api"'),
      body: stderr,
    })
  })

  it('resolves a single project root relative to cwd', () => {
    expect(resolveUvProjectRoot(['.'], projectRoot)).toBe(projectRoot)
    expect(resolveUvProjectRoot([projectRoot], projectRoot)).toBe(projectRoot)
  })

  it.each([[], ['.', '.'], ['pyproject.toml'], ['missing'], ['..']])(
    'rejects invalid project roots %j',
    (...targets) => {
      expect(() => resolveUvProjectRoot(targets, projectRoot)).toThrow(
        '--uv-package requires',
      )
    },
  )

  it.each(['pyproject.toml', 'uv.lock'])(
    'requires %s at the target root',
    async filename => {
      await fs.unlink(path.join(projectRoot, filename))
      expect(() => resolveUvProjectRoot(['.'], projectRoot)).toThrow(
        'requires pyproject.toml and uv.lock',
      )
    },
  )
})
