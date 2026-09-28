import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateUvPackageSboms } from './generate-uv-package-sboms.mts'
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
  properties?: Array<{ name: string; value: string }>
}

type Sbom = {
  bomFormat: string
  metadata: { component: Component }
  components: Component[]
  dependencies: Array<{ ref: string; dependsOn: string[] }>
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
  expect(
    sbom.components.find(c => c.name === 'tzdata')?.properties,
  ).toContainEqual({
    name: 'uv:package:marker',
    value: "sys_platform == 'win32'",
  })
  const refs = new Set(components.map(c => c['bom-ref']))
  for (const edge of sbom.dependencies) {
    expect(refs.has(edge.ref)).toBe(true)
    expect(edge.dependsOn.every(ref => refs.has(ref))).toBe(true)
  }
}

describe('uv package scans with the real uv binary', () => {
  let projectRoot: string
  let outputDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    projectRoot = await fs.mkdtemp(path.join(tmpdir(), 'socket-uv-project-'))
    outputDir = await fs.mkdtemp(path.join(tmpdir(), 'socket-uv-sboms-'))
    await fs.cp(fixture, projectRoot, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
    await fs.rm(outputDir, { recursive: true, force: true })
  })

  it('preserves pinned dependency edges, extras, groups and markers without unrelated packages', async () => {
    const lock = await fs.readFile(path.join(projectRoot, 'uv.lock'), 'utf8')
    const paths = await generateUvPackageSboms({
      outputDir,
      packageNames: ['workspace-api'],
      projectRoot,
    })
    assertApiGraph(JSON.parse(await fs.readFile(paths[0]!, 'utf8')))
    expect(await fs.readFile(path.join(projectRoot, 'uv.lock'), 'utf8')).toBe(
      lock,
    )
    expect(existsSync(path.join(projectRoot, '.venv'))).toBe(false)
  })

  it('exports distinct package roots and graphs when multiple packages are requested', async () => {
    const paths = await generateUvPackageSboms({
      outputDir,
      packageNames: ['workspace-api', 'workspace-other'],
      projectRoot,
    })
    expect(paths).toHaveLength(2)
    assertApiGraph(JSON.parse(await fs.readFile(paths[0]!, 'utf8')))
    const other = JSON.parse(await fs.readFile(paths[1]!, 'utf8')) as Sbom
    expect(other.metadata.component.name).toBe('workspace-other')
    expect(other.components.map(c => c.name)).toEqual(['sniffio'])
  })

  it('uses the existing pins when the member allows a newer version', async () => {
    const manifest = path.join(projectRoot, 'packages/api/pyproject.toml')
    await fs.writeFile(
      manifest,
      (await fs.readFile(manifest, 'utf8')).replace('idna==3.10', 'idna>=3'),
    )
    const paths = await generateUvPackageSboms({
      outputDir,
      packageNames: ['workspace-api'],
      projectRoot,
    })
    assertApiGraph(JSON.parse(await fs.readFile(paths[0]!, 'utf8')))
  })

  it('rejects unknown packages and does not fall back to the workspace root', async () => {
    await expect(
      generateUvPackageSboms({
        outputDir,
        packageNames: ['does-not-exist'],
        projectRoot,
      }),
    ).rejects.toThrow('Could not export uv package "does-not-exist"')
  })

  it('passes only the scoped graph to the SDK and cleans up after upload', async () => {
    let uploadRoot = ''
    mockCreateFullScan.mockImplementationOnce(
      async (_org, paths: string[], options) => {
        uploadRoot = options.pathsRelativeTo
        expect(paths).toEqual([
          path.join(uploadRoot, 'socket-workspace-api-cdx.json'),
        ])
        assertApiGraph(JSON.parse(await fs.readFile(paths[0]!, 'utf8')))
        expect(existsSync(path.join(uploadRoot, 'uv.lock'))).toBe(false)
        expect(existsSync(path.join(uploadRoot, 'pyproject.toml'))).toBe(false)
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
      targets: ['.'],
      tmp: true,
      uvPackages: ['workspace-api'],
    }
    await handleCreateNewScan(config)
    expect(mockCreateFullScan).toHaveBeenCalledOnce()
    expect(uploadRoot).not.toBe('')
    expect(existsSync(uploadRoot)).toBe(false)
  })
})
