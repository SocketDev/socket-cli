import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  generateUvMemberSboms,
  resolveUvMemberDirs,
} from './generate-uv-member-sboms.mts'

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }))

vi.mock('@socketsecurity/registry/lib/spawn', () => ({ spawn: mockSpawn }))

const sbom = JSON.stringify({
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { component: { name: 'api', 'bom-ref': 'api' } },
  components: [{ name: 'idna', version: '3.10', 'bom-ref': 'idna' }],
  dependencies: [{ ref: 'api', dependsOn: ['idna'] }],
})

describe('uv member SBOM export', () => {
  let cwd: string
  let apiDir: string
  let workerDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    cwd = await fs.mkdtemp(path.join(tmpdir(), 'socket-uv-unit-'))
    apiDir = path.join(cwd, 'packages/api')
    workerDir = path.join(cwd, 'packages/worker')
    await fs.mkdir(apiDir, { recursive: true })
    await fs.mkdir(workerDir, { recursive: true })
    await fs.writeFile(path.join(apiDir, 'pyproject.toml'), '')
    await fs.writeFile(path.join(workerDir, 'pyproject.toml'), '')
    mockSpawn.mockResolvedValue({ stdout: sbom })
  })

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
  })

  it('writes the graph beside the member and marks production dependencies as required', async () => {
    const { files } = await generateUvMemberSboms([apiDir])
    expect(files).toEqual([path.join(apiDir, 'socket-uv-cdx.json')])
    expect(JSON.parse(await fs.readFile(files[0]!, 'utf8'))).toEqual({
      ...JSON.parse(sbom),
      components: [
        { name: 'idna', version: '3.10', 'bom-ref': 'idna', scope: 'required' },
      ],
    })
    expect(mockSpawn).toHaveBeenCalledTimes(2)
    expect(mockSpawn).toHaveBeenNthCalledWith(
      1,
      'uv',
      [
        'export',
        '--project',
        apiDir,
        '--format',
        'cyclonedx1.5',
        '--frozen',
        '--offline',
        '--no-python-downloads',
        '--all-extras',
        '--all-groups',
      ],
      expect.objectContaining({ cwd: apiDir, stdio: 'pipe' }),
    )
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      'uv',
      [...mockSpawn.mock.calls[0]![1].slice(0, -1), '--no-default-groups'],
      expect.objectContaining({ cwd: apiDir, stdio: 'pipe' }),
    )
  })

  it('removes every written SBOM on cleanup', async () => {
    const { cleanup, files } = await generateUvMemberSboms([apiDir, workerDir])
    expect(files).toEqual([
      path.join(apiDir, 'socket-uv-cdx.json'),
      path.join(workerDir, 'socket-uv-cdx.json'),
    ])
    expect(files.every(existsSync)).toBe(true)
    await cleanup()
    expect(files.some(existsSync)).toBe(false)
  })

  it('matches package identities across exports without changing edges or metadata', async () => {
    const graph = {
      ...JSON.parse(sbom),
      components: [
        { name: 'shared', version: '1', 'bom-ref': 'shared-2' },
        { name: 'library', version: '1', 'bom-ref': 'library-3' },
        { name: 'library', version: '2', 'bom-ref': 'library-4' },
        {
          name: 'library',
          version: '1',
          purl: 'pkg:pypi/library@1?repository_url=https://other.example',
          'bom-ref': 'library-5',
        },
      ],
      dependencies: [
        { ref: 'api', dependsOn: ['shared-2', 'library-4'] },
        { ref: 'shared-2', dependsOn: ['library-3'] },
        { ref: 'library-4', dependsOn: ['library-5'] },
      ],
    }
    mockSpawn
      .mockResolvedValueOnce({ stdout: JSON.stringify(graph) })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          ...JSON.parse(sbom),
          components: [
            { name: 'shared', version: '1', 'bom-ref': 'shared-4' },
            { name: 'library', version: '1', 'bom-ref': 'library-2' },
          ],
        }),
      })
    const { files } = await generateUvMemberSboms([apiDir])
    expect(JSON.parse(await fs.readFile(files[0]!, 'utf8'))).toEqual({
      ...graph,
      components: graph.components.map((component, index) => ({
        ...component,
        scope: index < 2 ? 'required' : 'optional',
      })),
    })
  })

  it('marks all dependencies as development when the production graph is empty', async () => {
    mockSpawn.mockResolvedValueOnce({ stdout: sbom }).mockResolvedValueOnce({
      stdout: JSON.stringify({
        ...JSON.parse(sbom),
        components: undefined,
        dependencies: [],
      }),
    })
    const { files } = await generateUvMemberSboms([apiDir])
    expect(JSON.parse(await fs.readFile(files[0]!, 'utf8')).components).toEqual(
      [{ name: 'idna', version: '3.10', 'bom-ref': 'idna', scope: 'optional' }],
    )
  })

  it.each(['invalid graph', 'export failure'])(
    'writes no SBOM for any member when a later export has an %s',
    async failure => {
      mockSpawn
        .mockResolvedValueOnce({ stdout: sbom })
        .mockResolvedValueOnce({ stdout: sbom })
        .mockResolvedValueOnce({ stdout: sbom })
      if (failure === 'invalid graph') {
        mockSpawn.mockResolvedValueOnce({ stdout: '{}' })
      } else {
        mockSpawn.mockRejectedValueOnce(new Error('export failed'))
      }
      await expect(generateUvMemberSboms([apiDir, workerDir])).rejects.toThrow()
      expect(existsSync(path.join(apiDir, 'socket-uv-cdx.json'))).toBe(false)
      expect(existsSync(path.join(workerDir, 'socket-uv-cdx.json'))).toBe(false)
    },
  )

  it('removes SBOMs it already wrote when a later write fails', async () => {
    await fs.writeFile(path.join(workerDir, 'socket-uv-cdx.json'), 'user file')
    await expect(generateUvMemberSboms([apiDir, workerDir])).rejects.toThrow()
    expect(existsSync(path.join(apiDir, 'socket-uv-cdx.json'))).toBe(false)
    expect(
      await fs.readFile(path.join(workerDir, 'socket-uv-cdx.json'), 'utf8'),
    ).toBe('user file')
  })

  it.each([
    'not JSON',
    '{}',
    '{"bomFormat":"CycloneDX","metadata":{"component":{"name":"api"}}}',
    '{"bomFormat":"CycloneDX","dependencies":[]}',
  ])('rejects an invalid SBOM', async stdout => {
    mockSpawn.mockResolvedValueOnce({ stdout })
    await expect(generateUvMemberSboms([apiDir])).rejects.toThrow(
      `uv did not return a CycloneDX dependency graph for ${apiDir}`,
    )
    expect(existsSync(path.join(apiDir, 'socket-uv-cdx.json'))).toBe(false)
  })

  it.each([
    'Unable to find lockfile at `uv.lock`',
    'Unsupported lockfile version',
    'uv is not installed',
  ])('reports an export failure: %s', async stderr => {
    mockSpawn.mockRejectedValueOnce(
      Object.assign(new Error('command failed'), { stderr }),
    )
    await expect(generateUvMemberSboms([apiDir])).rejects.toMatchObject({
      message: expect.stringContaining(
        `Could not export the uv dependency graph for ${apiDir}`,
      ),
      body: stderr,
    })
  })

  it('resolves member directories relative to cwd and deduplicates them', () => {
    expect(
      resolveUvMemberDirs(
        ['packages/api', './packages/api/', apiDir, 'packages/worker'],
        cwd,
      ),
    ).toEqual([apiDir, workerDir])
  })

  it.each([
    ['packages/missing', 'directory inside --cwd'],
    ['packages/api/pyproject.toml', 'directory inside --cwd'],
    ['..', 'directory inside --cwd'],
    ['packages', 'requires a pyproject.toml in every TARGET'],
  ])('rejects target %j', (target, error) => {
    expect(() => resolveUvMemberDirs([target], cwd)).toThrow(error)
  })

  it('refuses to overwrite an existing SBOM in a member directory', async () => {
    await fs.writeFile(path.join(apiDir, 'socket-uv-cdx.json'), '{}')
    expect(() => resolveUvMemberDirs(['packages/api'], cwd)).toThrow(
      'already exists',
    )
  })
})
