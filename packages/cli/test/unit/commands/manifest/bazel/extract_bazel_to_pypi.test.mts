/**
 * Unit tests for the PyPI extraction pipeline over mocked collaborators:
 * requirements.txt synthesis, lockfile-pins-win, spoke-tag fallback, and the
 * cross-hub conflict gate.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger so narration is capturable without TTY noise.
const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock the helpers BEFORE importing the pipeline.
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-workspace-detect.mts'),
  () => ({
    detectWorkspaceMode: vi.fn(),
    getBazelInvocationFlags: vi.fn(() => []),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-bin-detect.mts'),
  () => ({
    resolveBazelBinary: vi.fn(async () => '/usr/local/bin/bazel'),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-pypi-candidates.mts'),
  () => ({
    parseBazelModPipExtensionCandidates: vi.fn(() => [
      {
        hubName: 'pypi',
        pythonVersion: '3.12',
        requirementsLockLabel: '//:requirements_lock.txt',
        source: 'bazel-mod-show-extension',
        workspaceMode: 'bzlmod',
      },
    ]),
    parseVisibleRepoCandidates: vi.fn(() => []),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-pypi-discovery.mts'),
  () => ({
    discoverPypiHubs: vi.fn(),
  }),
)
const { probe } = vi.hoisted(() => ({
  probe: async () => ({
    code: 0,
    stderr: '',
    stdout: '@pypi//requests:pkg\n',
  }),
}))
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-query-runner.mts'),
  () => ({
    buildPypiProbeFor: vi.fn(() => probe),
    runBazelModShowPipExtension: vi.fn(async () => ({
      code: 0,
      stderr: '',
      stdout:
        'pip.parse(hub_name="pypi", python_version="3.12", requirements_lock="//:requirements_lock.txt")\nuse_repo(pip, "pypi")\n',
    })),
    runBazelModShowVisibleRepos: vi.fn(async () => ({
      code: 0,
      stderr: '',
      stdout: '',
    })),
    runBazelQuery: vi.fn(),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-output-base-check.mts'),
  () => ({
    validateOutputBase: vi.fn(),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/bazel-python-shim.mts'),
  () => ({
    provisionPythonShim: vi.fn(async () => ({
      augmentedEnv: undefined,
      shimDir: undefined,
    })),
  }),
)

import { validateOutputBase } from '../../../../../src/commands/manifest/bazel/bazel-output-base-check.mts'
import { parseBazelModPipExtensionCandidates } from '../../../../../src/commands/manifest/bazel/bazel-pypi-candidates.mts'
import { discoverPypiHubs } from '../../../../../src/commands/manifest/bazel/bazel-pypi-discovery.mts'
import {
  runBazelModShowPipExtension,
  runBazelQuery,
} from '../../../../../src/commands/manifest/bazel/bazel-query-runner.mts'
import { detectWorkspaceMode } from '../../../../../src/commands/manifest/bazel/bazel-workspace-detect.mts'
import { extractBazelToPypi } from '../../../../../src/commands/manifest/bazel/extract_bazel_to_pypi.mts'

describe('extractBazelToPypi', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'bazel-extract-'))
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: true,
      workspace: false,
    })
    vi.mocked(parseBazelModPipExtensionCandidates).mockReturnValue([
      {
        hubName: 'pypi',
        pythonVersion: '3.12',
        requirementsLockLabel: '//:requirements_lock.txt',
        source: 'bazel-mod-show-extension',
        workspaceMode: 'bzlmod',
      },
    ])
    process.exitCode = 0
  })

  afterEach(async () => {
    await safeDelete(tmp)
    vi.resetAllMocks()
    process.exitCode = 0
  })

  it('writes requirements.txt with sorted name==version lines', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(
      new Map([
        [
          'pypi',
          {
            hubName: 'pypi',
            probeStdout: '@pypi//requests:pkg\n@pypi//numpy:pkg',
            requirementsLockLabel: '//:requirements_lock.txt',
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
          },
        ],
      ]),
    )
    vi.mocked(runBazelQuery)
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: '@pypi//requests:pkg\n@pypi//numpy:pkg',
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: 'pypi_name=numpy\npypi_version=2.4.4',
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: 'pypi_name=requests\npypi_version=2.33.1',
      })

    // Create a requirements_lock.txt in the temp dir.
    const lockPath = path.join(tmp, 'requirements_lock.txt')
    writeFileSync(lockPath, 'requests==2.33.1\n', 'utf8')

    const result = await extractBazelToPypi({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(result).toEqual({
      artifactCount: expect.any(Number),
      manifestPath: path.join(tmp, 'requirements.txt'),
      ok: true,
    })

    const content = readFileSync(path.join(tmp, 'requirements.txt'), 'utf8')
    expect(content).toContain('requests==2.33.1')
  })

  it('writes to .socket-auto-manifest/requirements.txt when outLayout is flat', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(
      new Map([
        [
          'pypi',
          {
            hubName: 'pypi',
            probeStdout: '@pypi//requests:pkg',
            requirementsLockLabel: '//:requirements_lock.txt',
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
          },
        ],
      ]),
    )
    vi.mocked(runBazelQuery)
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: '@pypi//requests:pkg',
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: 'pypi_name=requests\npypi_version=2.33.1',
      })

    writeFileSync(
      path.join(tmp, 'requirements_lock.txt'),
      'requests==2.33.1\n',
      'utf8',
    )

    const result = await extractBazelToPypi({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      outLayout: 'flat',
      verbose: false,
    })

    expect(result.manifestPath).toBe(
      path.join(tmp, '.socket-auto-manifest', 'requirements.txt'),
    )
    expect(
      existsSync(path.join(tmp, '.socket-auto-manifest', 'requirements.txt')),
    ).toBe(true)
    expect(existsSync(path.join(tmp, 'requirements.txt'))).toBe(false)
  })

  it('returns noEcosystemFound when no hubs are discovered', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(new Map())

    const result = await extractBazelToPypi({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(result).toEqual({
      artifactCount: 0,
      noEcosystemFound: true,
      ok: false,
    })
  })

  it('handles lockfile-vs-spoke divergence by preferring lockfile', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(
      new Map([
        [
          'pypi',
          {
            hubName: 'pypi',
            probeStdout: '@pypi//requests:pkg',
            requirementsLockLabel: '//:requirements_lock.txt',
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
          },
        ],
      ]),
    )
    vi.mocked(runBazelQuery)
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: '@pypi//requests:pkg',
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: 'pypi_name=requests\npypi_version=3.0.0',
      })

    writeFileSync(
      path.join(tmp, 'requirements_lock.txt'),
      'requests==2.33.1\n',
      'utf8',
    )

    const result = await extractBazelToPypi({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(result.ok).toBe(true)
    const content = readFileSync(result.manifestPath!, 'utf8')
    expect(content).toContain('requests==2.33.1')
    expect(content).not.toContain('requests==3.0.0')
  })

  it('handles duplicate normalized names with same version', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(
      new Map([
        [
          'pypi',
          {
            hubName: 'pypi',
            probeStdout:
              '@pypi//charset_normalizer:pkg\n@pypi//charset-normalizer:pkg',
            requirementsLockLabel: '//:requirements_lock.txt',
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
          },
        ],
      ]),
    )
    vi.mocked(runBazelQuery)
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: '@pypi//charset_normalizer:pkg\n@pypi//charset-normalizer:pkg',
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: 'pypi_name=charset-normalizer\npypi_version=3.4.7',
      })

    writeFileSync(
      path.join(tmp, 'requirements_lock.txt'),
      'charset-normalizer==3.4.7\n',
      'utf8',
    )

    const result = await extractBazelToPypi({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(result.ok).toBe(true)
    const content = readFileSync(result.manifestPath!, 'utf8')
    // Should only appear once (deduped).
    const matches = content.match(/charset-normalizer==3\.4\.7/g)
    expect(matches?.length).toBe(1)
  })
})
