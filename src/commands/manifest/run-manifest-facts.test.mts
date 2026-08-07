import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./scripts/run.mts', () => ({
  runManifestScript: vi.fn(),
}))

import { runManifestFacts } from './run-manifest-facts.mts'
import { runManifestScript } from './scripts/run.mts'

import type { ManifestRunResult } from './scripts/run.mts'
import type { SidecarAccumulator } from './scripts/sidecar.mts'

const ENV_VAR = 'SOCKET_TEST_JAVA_HOME'

function okResult(): ManifestRunResult {
  return {
    code: 0,
    facts: {
      components: [{ id: 'a', type: 'maven', name: 'a' }],
      projects: [],
    },
    report: { failures: [], scannedConfigs: [], unscannable: [] },
    artifactPaths: {
      targetsByCoord: new Map(),
      targetsByGav: new Map(),
      sourcesByCoord: new Map(),
      coords: new Set(),
    },
    stderr: '',
    stdout: '',
  }
}

const baseArgs = {
  bin: 'mvn',
  buildOpts: [],
  ecosystem: 'maven' as const,
  excludeConfigs: '',
  ignoreUnresolved: false,
  includeConfigs: '',
  verbose: false,
}

describe('runManifestFacts - javaHome', () => {
  let cwd = ''

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(tmpdir(), 'run-manifest-facts-'))
    vi.mocked(runManifestScript).mockReset()
    delete process.env[ENV_VAR]
    process.exitCode = undefined
  })
  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
    delete process.env[ENV_VAR]
    process.exitCode = undefined
  })

  it('passes a literal javaHome straight through as JAVA_HOME', async () => {
    vi.mocked(runManifestScript).mockResolvedValue(okResult())
    await runManifestFacts({ ...baseArgs, cwd, javaHome: '/opt/jdk-17' })
    const opts = vi.mocked(runManifestScript).mock.calls[0]?.[1]
    expect(opts?.env?.['JAVA_HOME']).toBe('/opt/jdk-17')
  })

  it('expands $VAR and ${VAR} references against the CLI process env', async () => {
    process.env[ENV_VAR] = '/opt/jdk-11'
    vi.mocked(runManifestScript).mockResolvedValue(okResult())
    await runManifestFacts({
      ...baseArgs,
      cwd,
      javaHome: `\${${ENV_VAR}}`,
    })
    const opts = vi.mocked(runManifestScript).mock.calls[0]?.[1]
    expect(opts?.env?.['JAVA_HOME']).toBe('/opt/jdk-11')
  })

  it('fails closed without invoking the build tool when the referenced var is unset', async () => {
    vi.mocked(runManifestScript).mockResolvedValue(okResult())
    const result = await runManifestFacts({
      ...baseArgs,
      cwd,
      javaHome: `$${ENV_VAR}`,
    })
    expect(result).toBeNull()
    expect(runManifestScript).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('leaves the environment untouched when javaHome is unset', async () => {
    vi.mocked(runManifestScript).mockResolvedValue(okResult())
    await runManifestFacts({ ...baseArgs, cwd })
    const opts = vi.mocked(runManifestScript).mock.calls[0]?.[1]
    expect(opts?.env).toBeUndefined()
  })
})

describe('runManifestFacts - sidecar', () => {
  let cwd = ''

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(tmpdir(), 'run-manifest-facts-'))
    vi.mocked(runManifestScript).mockReset()
    process.exitCode = undefined
  })
  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
    process.exitCode = undefined
  })

  it('keys the sidecar by the symlink-resolved factsPath, not the raw cwd-joined one', async () => {
    const result = okResult()
    result.facts.projects = [
      {
        type: 'maven',
        namespace: 'com.example',
        name: 'app',
        version: '1.0',
        subprojectDir: '.',
        dependencies: [],
        resolvedAs: [],
      },
    ]
    vi.mocked(runManifestScript).mockResolvedValue(result)

    const sidecarAcc: SidecarAccumulator = new Map()
    await runManifestFacts({ ...baseArgs, cwd, sidecarAcc, withFiles: true })

    const expectedFactsFile = await fs.realpath(
      path.join(cwd, '.socket.facts.json'),
    )
    expect([...sidecarAcc.keys()]).toEqual([expectedFactsFile])
    const bucket = sidecarAcc.get(expectedFactsFile)
    expect(bucket?.projects.find(m => m.name === 'app')).toBeDefined()
  })
})
