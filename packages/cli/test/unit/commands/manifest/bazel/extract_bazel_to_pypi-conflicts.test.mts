/**
 * Unit tests for the PyPI extraction pipeline over mocked collaborators:
 * conflict gates, lockfile-first resolution, alias-to-spoke resolution, and
 * discovery argument forwarding.
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

describe('extractBazelToPypi conflicts + discovery forwarding', () => {
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

  it('returns failure without mutating process.exitCode when conflicting versions exist', async () => {
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
        [
          'other',
          {
            hubName: 'other',
            probeStdout: '@other//requests:pkg',
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
        stdout: '@other//requests:pkg',
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

    expect(process.exitCode).toBe(0)
    expect(result.ok).toBe(false)
  })

  it('returns failure when a lockfile has conflicting normalized entries', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(
      new Map([
        [
          'pypi',
          {
            hubName: 'pypi',
            probeStdout: '@pypi//foo_bar:pkg',
            requirementsLockLabel: '//:requirements_lock.txt',
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
          },
        ],
      ]),
    )

    writeFileSync(
      path.join(tmp, 'requirements_lock.txt'),
      'foo-bar==1.0.0\nFoo_Bar==2.0.0\n',
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

    expect(process.exitCode).toBe(0)
    expect(result.ok).toBe(false)
    expect(runBazelQuery).not.toHaveBeenCalled()
  })

  it('does not query spoke tags for packages resolved by the lockfile', async () => {
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
    vi.mocked(runBazelQuery).mockResolvedValueOnce({
      code: 0,
      stderr: '',
      stdout: '@pypi//requests:pkg',
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
    expect(runBazelQuery).toHaveBeenCalledTimes(1)
  })

  it('resolves hub aliases to spoke targets before parsing PyPI metadata', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(
      new Map([
        [
          'pypi',
          {
            hubName: 'pypi',
            probeStdout: '@pypi//requests:pkg',
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
        stdout: 'alias(name = "pkg", actual = "@pypi_requests//:pkg")',
      })
      .mockResolvedValueOnce({
        code: 0,
        stderr: '',
        stdout: 'pypi_name=requests\npypi_version=2.33.1',
      })

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
    expect(readFileSync(result.manifestPath!, 'utf8')).toBe(
      'requests==2.33.1\n',
    )
    expect(runBazelQuery).toHaveBeenLastCalledWith(
      '@pypi_requests//:pkg',
      expect.any(Object),
    )
  })

  it('calls validateOutputBase when bazelOutputBase is set', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(new Map())
    await extractBazelToPypi({
      bazelFlags: undefined,
      bazelOutputBase: tmp,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })
    expect(vi.mocked(validateOutputBase)).toHaveBeenCalledWith(tmp, tmp)
  })

  it('passes bazel mod show_extension candidates into discovery first', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(new Map())

    await extractBazelToPypi({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
    })

    expect(runBazelModShowPipExtension).toHaveBeenCalled()
    expect(discoverPypiHubs).toHaveBeenCalledWith(tmp, expect.any(Function), {
      bazelCommandCandidates: [
        {
          hubName: 'pypi',
          pythonVersion: '3.12',
          requirementsLockLabel: '//:requirements_lock.txt',
          source: 'bazel-mod-show-extension',
          workspaceMode: 'bzlmod',
        },
      ],
      nativeCandidates: [],
      verbose: false,
    })
  })
})
