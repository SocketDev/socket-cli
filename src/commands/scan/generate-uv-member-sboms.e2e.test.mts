import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateUvMemberSboms } from './generate-uv-member-sboms.mts'
import { handleCreateNewScan } from './handle-create-new-scan.mts'

import type { HandleCreateNewScanConfig } from './handle-create-new-scan.mts'

const { mockCreateFullScan } = vi.hoisted(() => ({
  mockCreateFullScan: vi.fn(),
}))

vi.mock('./fetch-supported-scan-file-names.mts', () => ({
  fetchSupportedScanFileNames: async () => ({
    ok: true,
    data: { cdx: { json: { pattern: '*cdx.json' } } },
  }),
}))

vi.mock('./output-create-new-scan.mts', () => ({
  outputCreateNewScan: vi.fn(),
}))

vi.mock('../../utils/sdk.mts', () => ({
  setupSdk: async () => ({
    ok: true,
    data: { createFullScan: mockCreateFullScan },
  }),
}))

const fixture = fileURLToPath(
  new URL('../../../test/fixtures/commands/scan/uv-workspace', import.meta.url),
)

type Component = {
  'bom-ref': string
  name: string
  version: string
  scope?: string
  properties?: Array<{ name: string; value: string }>
}

type Sbom = {
  bomFormat: string
  metadata: { component: Component }
  components: Component[]
  dependencies: Array<{ ref: string; dependsOn?: string[] }>
}

function assertApiGraph(sbom: Sbom): void {
  expect(sbom.bomFormat).toBe('CycloneDX')
  expect(sbom.metadata.component.name).toBe('workspace-api')
  const components = [sbom.metadata.component, ...sbom.components]
  const nameToRef = new Map(components.map(c => [c.name, c['bom-ref']]))
  const edges = new Map(sbom.dependencies.map(d => [d.ref, d.dependsOn]))
  expect(edges.get(nameToRef.get('workspace-api')!)).toContain(
    nameToRef.get('workspace-shared'),
  )
  expect(edges.get(nameToRef.get('workspace-shared')!)).toContain(
    nameToRef.get('typing-extensions'),
  )
  expect(edges.get(nameToRef.get('workspace-api')!)).not.toContain(
    nameToRef.get('typing-extensions'),
  )
  expect(sbom.components.map(c => `${c.name}@${c.version}`).sort()).toEqual([
    'colorama@0.4.6',
    'idna@3.10',
    'iniconfig@2.1.0',
    'typing-extensions@4.12.2',
    'tzdata@2025.1',
    'workspace-shared@0.1.0',
  ])
  for (const component of sbom.components) {
    expect(component.scope).toBe(
      component.name === 'iniconfig' ? 'optional' : 'required',
    )
  }
  expect(
    sbom.components.find(c => c.name === 'tzdata')?.properties,
  ).toContainEqual({
    name: 'uv:package:marker',
    value: "sys_platform == 'win32'",
  })
  const refs = new Set(components.map(c => c['bom-ref']))
  for (const edge of sbom.dependencies) {
    expect(refs.has(edge.ref)).toBe(true)
    // uv 0.12 omits dependsOn for leaf nodes.
    expect((edge.dependsOn ?? []).every(ref => refs.has(ref))).toBe(true)
  }
}

describe('uv member scans with the real uv binary', () => {
  let apiDir: string
  let projectRoot: string

  beforeEach(async () => {
    vi.clearAllMocks()
    projectRoot = await fs.mkdtemp(path.join(tmpdir(), 'socket-uv-project-'))
    apiDir = path.join(projectRoot, 'packages/api')
    await fs.cp(fixture, projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  it('preserves pinned dependency edges, extras, groups and markers without unrelated packages', async () => {
    const lock = await fs.readFile(path.join(projectRoot, 'uv.lock'), 'utf8')
    const { files } = await generateUvMemberSboms([apiDir])
    expect(files).toEqual([path.join(apiDir, 'socket-uv-cdx.json')])
    assertApiGraph(JSON.parse(await fs.readFile(files[0]!, 'utf8')))
    expect(await fs.readFile(path.join(projectRoot, 'uv.lock'), 'utf8')).toBe(
      lock,
    )
    expect(existsSync(path.join(projectRoot, '.venv'))).toBe(false)
    expect(existsSync(path.join(apiDir, '.venv'))).toBe(false)
  })

  it('exports distinct package roots and graphs when multiple members are requested', async () => {
    const { files } = await generateUvMemberSboms([
      apiDir,
      path.join(projectRoot, 'packages/other'),
    ])
    expect(files).toHaveLength(2)
    assertApiGraph(JSON.parse(await fs.readFile(files[0]!, 'utf8')))
    const other = JSON.parse(await fs.readFile(files[1]!, 'utf8')) as Sbom
    expect(other.metadata.component.name).toBe('workspace-other')
    expect(
      other.components.filter(c => c.scope === 'required').map(c => c.name),
    ).toEqual(['sniffio'])
    // uv 0.12 adds the workspace root's dependency groups to this member.
    for (const name of ['colorama', 'idna', 'iniconfig']) {
      expect(other.components.map(c => c.name)).not.toContain(name)
    }
  })

  it('uses the existing pins when the member allows a newer version', async () => {
    const manifest = path.join(projectRoot, 'packages/api/pyproject.toml')
    await fs.writeFile(
      manifest,
      (await fs.readFile(manifest, 'utf8')).replace('idna==3.10', 'idna>=3'),
    )
    const { files } = await generateUvMemberSboms([apiDir])
    assertApiGraph(JSON.parse(await fs.readFile(files[0]!, 'utf8')))
  })

  it('classifies transitive group dependencies and keeps shared production dependencies required', async () => {
    const manifest = path.join(projectRoot, 'packages/api/pyproject.toml')
    await fs.writeFile(
      manifest,
      (await fs.readFile(manifest, 'utf8'))
        .replace(
          'dev = ["iniconfig==2.1.0"]',
          'dev = ["iniconfig==2.1.0", "idna==3.10", "workspace-other"]\nqa = ["packaging==24.2"]',
        )
        .concat(
          '\nworkspace-other = { workspace = true }\n[tool.uv]\ndefault-groups = ["dev", "qa"]\n',
        ),
    )
    const lockfile = path.join(projectRoot, 'uv.lock')
    await fs.writeFile(
      lockfile,
      (await fs.readFile(lockfile, 'utf8')).replace(
        'dev = [\n    { name = "iniconfig" },\n]',
        'dev = [\n    { name = "iniconfig" },\n    { name = "idna" },\n    { name = "workspace-other" },\n]\nqa = [{ name = "packaging" }]',
      ),
    )
    const { files } = await generateUvMemberSboms([apiDir])
    const sbom = JSON.parse(await fs.readFile(files[0]!, 'utf8')) as Sbom
    expect(
      Object.fromEntries(sbom.components.map(c => [c.name, c.scope])),
    ).toEqual({
      colorama: 'required',
      idna: 'required',
      iniconfig: 'optional',
      packaging: 'optional',
      sniffio: 'optional',
      'typing-extensions': 'required',
      tzdata: 'required',
      'workspace-other': 'optional',
      'workspace-shared': 'required',
    })
  })

  it('rejects a project outside any uv workspace without writing an SBOM', async () => {
    const loneDir = await fs.mkdtemp(path.join(tmpdir(), 'socket-uv-lone-'))
    try {
      await fs.writeFile(
        path.join(loneDir, 'pyproject.toml'),
        '[project]\nname = "lone"\nversion = "0.1.0"\ndependencies = []\n',
      )
      await expect(generateUvMemberSboms([loneDir])).rejects.toMatchObject({
        message: expect.stringContaining(
          `Could not export the uv dependency graph for ${loneDir}`,
        ),
        body: expect.stringContaining('uv.lock'),
      })
      expect(existsSync(path.join(loneDir, 'socket-uv-cdx.json'))).toBe(false)
    } finally {
      await fs.rm(loneDir, { recursive: true, force: true })
    }
  })

  it('passes only the member graph to the SDK and cleans up after upload', async () => {
    const sbomPath = path.join(apiDir, 'socket-uv-cdx.json')
    mockCreateFullScan.mockImplementationOnce(
      async (_org, paths: string[], options) => {
        expect(options.pathsRelativeTo).toBe(projectRoot)
        expect(paths).toEqual([sbomPath])
        assertApiGraph(JSON.parse(await fs.readFile(paths[0]!, 'utf8')))
        return { success: true, status: 200, data: { id: 'test-scan' } }
      },
    )
    const config: HandleCreateNewScanConfig = {
      autoManifest: false,
      branchName: 'main',
      commitHash: '',
      commitMessage: '',
      committers: '',
      cwd: projectRoot,
      defaultBranch: false,
      generateScanFiles: () => generateUvMemberSboms([apiDir]),
      interactive: false,
      orgSlug: 'test-org',
      outputKind: 'text',
      pendingHead: false,
      pullRequest: 0,
      reach: {
        dynamicSbomInference: false,
        excludePaths: [],
        reachAnalysisMemoryLimit: '8192',
        reachAnalysisTimeout: '',
        reachConcurrency: 1,
        reachContinueOnAnalysisErrors: false,
        reachContinueOnInstallErrors: false,
        reachContinueOnMissingLockFiles: false,
        reachContinueOnNoSourceFiles: false,
        reachDebug: false,
        reachDetailedAnalysisLogFile: false,
        reachDisableAnalytics: false,
        reachDisableExternalToolChecks: false,
        reachEcosystems: [],
        reachEnableAnalysisSplitting: false,
        reachExcludePaths: [],
        reachFallbackToRegularScan: false,
        reachRetainFactsFile: false,
        reachSkipCache: false,
        reachUseOnlyPregeneratedSboms: false,
        reachVersion: undefined,
        runReachabilityAnalysis: false,
      },
      readOnly: false,
      repoName: 'test-repo',
      report: false,
      reportLevel: 'error',
      targets: ['packages/api'],
      tmp: true,
    }
    await handleCreateNewScan(config)
    expect(mockCreateFullScan).toHaveBeenCalledOnce()
    expect(existsSync(sbomPath)).toBe(false)
  })
})
