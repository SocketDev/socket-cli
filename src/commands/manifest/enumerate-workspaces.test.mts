import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./scripts/run.mts', () => ({
  enumerateWorkspaces: vi.fn(),
}))

import { enumerateWorkspaces } from './enumerate-workspaces.mts'
import { enumerateWorkspaces as enumerateWorkspacesScript } from './scripts/run.mts'

import type { WorkspaceEnumerationResult } from './scripts/run.mts'

const ENV_VAR = 'SOCKET_TEST_ENUMERATE_JAVA_HOME'

function okResult(): WorkspaceEnumerationResult {
  return {
    code: 0,
    projects: [
      {
        type: 'maven',
        name: 'root',
        subprojectDir: '.',
        dependencies: [],
        resolvedAs: [],
      },
    ],
    stderr: '',
    stdout: '',
  }
}

const baseArgs = {
  bin: 'gradle',
  buildOpts: [],
  cwd: '/tmp/some-project',
  ecosystem: 'gradle' as const,
  verbose: false,
}

describe('enumerateWorkspaces', () => {
  beforeEach(() => {
    vi.mocked(enumerateWorkspacesScript).mockReset()
    delete process.env[ENV_VAR]
    process.exitCode = undefined
  })

  it('returns the projects from a successful run', async () => {
    vi.mocked(enumerateWorkspacesScript).mockResolvedValue(okResult())
    const result = await enumerateWorkspaces(baseArgs)
    expect(result?.projects).toEqual(okResult().projects)
  })

  it('passes a literal javaHome straight through as JAVA_HOME', async () => {
    vi.mocked(enumerateWorkspacesScript).mockResolvedValue(okResult())
    await enumerateWorkspaces({ ...baseArgs, javaHome: '/opt/jdk-17' })
    const opts = vi.mocked(enumerateWorkspacesScript).mock.calls[0]?.[1]
    expect(opts?.env?.['JAVA_HOME']).toBe('/opt/jdk-17')
  })

  it('expands $VAR and ${VAR} references against the CLI process env', async () => {
    process.env[ENV_VAR] = '/opt/jdk-11'
    vi.mocked(enumerateWorkspacesScript).mockResolvedValue(okResult())
    await enumerateWorkspaces({ ...baseArgs, javaHome: `\${${ENV_VAR}}` })
    const opts = vi.mocked(enumerateWorkspacesScript).mock.calls[0]?.[1]
    expect(opts?.env?.['JAVA_HOME']).toBe('/opt/jdk-11')
    delete process.env[ENV_VAR]
  })

  it('fails closed without invoking the build tool when the referenced var is unset', async () => {
    vi.mocked(enumerateWorkspacesScript).mockResolvedValue(okResult())
    const result = await enumerateWorkspaces({
      ...baseArgs,
      javaHome: `$${ENV_VAR}`,
    })
    expect(result).toBeUndefined()
    expect(enumerateWorkspacesScript).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('leaves the environment untouched when javaHome is unset', async () => {
    vi.mocked(enumerateWorkspacesScript).mockResolvedValue(okResult())
    await enumerateWorkspaces(baseArgs)
    const opts = vi.mocked(enumerateWorkspacesScript).mock.calls[0]?.[1]
    expect(opts?.env).toBeUndefined()
  })

  it('fails when the build crashed before producing any workspace records', async () => {
    vi.mocked(enumerateWorkspacesScript).mockResolvedValue({
      code: 1,
      projects: [],
      stderr: '',
      stdout: '',
    })
    const result = await enumerateWorkspaces(baseArgs)
    expect(result).toBeUndefined()
    expect(process.exitCode).toBe(1)
  })
})
