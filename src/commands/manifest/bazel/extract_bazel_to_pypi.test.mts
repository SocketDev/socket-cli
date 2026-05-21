import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the helpers BEFORE importing the orchestrator.
vi.mock('./bazel-workspace-detect.mts', () => ({
  detectWorkspaceMode: vi.fn(),
  getBazelInvocationFlags: vi.fn(() => []),
}))
vi.mock('./bazel-bin-detect.mts', () => ({
  resolveBazelBinary: vi.fn(async () => '/usr/local/bin/bazel'),
}))
vi.mock('./bazel-pypi-discovery.mts', () => ({
  discoverPypiHubs: vi.fn(),
}))
const { probe } = vi.hoisted(() => ({
  probe: async () => ({ code: 0, stdout: '@pypi//requests:pkg\n' }),
}))
vi.mock('./bazel-query-runner.mts', () => ({
  buildPypiProbeFor: vi.fn(() => probe),
  buildProbeFor: vi.fn(() => probe),
  runBazelModShowVisibleRepos: vi.fn(async () => ({
    code: 0,
    stderr: '',
    stdout: '',
  })),
  runBazelQuery: vi.fn(),
}))
vi.mock('./bazel-output-base-check.mts', () => ({
  validateOutputBase: vi.fn(),
}))
vi.mock('./bazel-python-shim.mts', () => ({
  provisionPythonShim: vi.fn(async () => ({
    augmentedEnv: undefined,
    shimDir: undefined,
  })),
}))

import { validateOutputBase } from './bazel-output-base-check.mts'
import { discoverPypiHubs } from './bazel-pypi-discovery.mts'
import { runBazelQuery } from './bazel-query-runner.mts'
import { detectWorkspaceMode } from './bazel-workspace-detect.mts'
import {
  type ExtractBazelToPypiResult,
  extractBazelToPypi,
} from './extract_bazel_to_pypi.mts'

describe('extractBazelToPypi', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'bazel-extract-'))
    vi.mocked(detectWorkspaceMode).mockReturnValue({
      bzlmod: true,
      workspace: false,
    })
    process.exitCode = 0
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
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
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
            requirementsLockLabel: '//:requirements_lock.txt',
            probeStdout: '@pypi//requests:pkg\n@pypi//numpy:pkg',
          },
        ],
      ]),
    )
    vi.mocked(runBazelQuery)
      .mockResolvedValueOnce({
        code: 0,
        stdout: '@pypi//requests:pkg\n@pypi//numpy:pkg',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'pypi_name=numpy\npypi_version=2.4.4',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'pypi_name=requests\npypi_version=2.33.1',
        stderr: '',
      })

    // Create a requirements_lock.txt in the temp dir.
    const lockPath = path.join(tmp, 'requirements_lock.txt')
    const { writeFileSync } = await import('node:fs')
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
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
            requirementsLockLabel: '//:requirements_lock.txt',
            probeStdout: '@pypi//requests:pkg',
          },
        ],
      ]),
    )
    vi.mocked(runBazelQuery)
      .mockResolvedValueOnce({
        code: 0,
        stdout: '@pypi//requests:pkg',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'pypi_name=requests\npypi_version=2.33.1',
        stderr: '',
      })

    const { writeFileSync } = await import('node:fs')
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

  it('returns noEcosystemFound when no hubs and explicitEcosystem=true', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(new Map())

    const result = await extractBazelToPypi({
      bazelFlags: undefined,
      bazelOutputBase: undefined,
      bazelRc: undefined,
      bin: undefined,
      cwd: tmp,
      out: tmp,
      verbose: false,
      explicitEcosystem: true,
    })

    expect(result).toEqual({
      artifactCount: 0,
      ok: false,
      noEcosystemFound: true,
    })
  })

  it('returns ok=true with zero artifacts when no hubs and explicitEcosystem=false (auto)', async () => {
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
      ok: true,
    })
  })

  it('handles lockfile-vs-spoke divergence by preferring lockfile', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(
      new Map([
        [
          'pypi',
          {
            hubName: 'pypi',
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
            requirementsLockLabel: '//:requirements_lock.txt',
            probeStdout: '@pypi//requests:pkg',
          },
        ],
      ]),
    )
    vi.mocked(runBazelQuery)
      .mockResolvedValueOnce({
        code: 0,
        stdout: '@pypi//requests:pkg',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'pypi_name=requests\npypi_version=3.0.0',
        stderr: '',
      })

    const { writeFileSync } = await import('node:fs')
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
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
            requirementsLockLabel: '//:requirements_lock.txt',
            probeStdout:
              '@pypi//charset_normalizer:pkg\n@pypi//charset-normalizer:pkg',
          },
        ],
      ]),
    )
    vi.mocked(runBazelQuery)
      .mockResolvedValueOnce({
        code: 0,
        stdout: '@pypi//charset_normalizer:pkg\n@pypi//charset-normalizer:pkg',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'pypi_name=charset-normalizer\npypi_version=3.4.7',
        stderr: '',
      })

    const { writeFileSync } = await import('node:fs')
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

  it('sets process.exitCode = 1 when conflicting versions exist', async () => {
    vi.mocked(discoverPypiHubs).mockResolvedValue(
      new Map([
        [
          'pypi',
          {
            hubName: 'pypi',
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
            requirementsLockLabel: '//:requirements_lock.txt',
            probeStdout: '@pypi//requests:pkg',
          },
        ],
        [
          'other',
          {
            hubName: 'other',
            source: 'MODULE.bazel',
            workspaceMode: 'bzlmod',
            probeStdout: '@other//requests:pkg',
          },
        ],
      ]),
    )
    vi.mocked(runBazelQuery)
      .mockResolvedValueOnce({
        code: 0,
        stdout: '@pypi//requests:pkg',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'pypi_name=requests\npypi_version=2.33.1',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: '@other//requests:pkg',
        stderr: '',
      })
      .mockResolvedValueOnce({
        code: 0,
        stdout: 'pypi_name=requests\npypi_version=3.0.0',
        stderr: '',
      })

    const { writeFileSync } = await import('node:fs')
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

    expect(process.exitCode).toBe(1)
    expect(result.ok).toBe(false)
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
})
