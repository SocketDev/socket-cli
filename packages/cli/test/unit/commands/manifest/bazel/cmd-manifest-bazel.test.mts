/**
 * Unit tests for the `socket manifest bazel` command: the ecosystem outcome
 * matrix, flag wiring into the extractors, and dry-run behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger so outcome messaging is capturable without TTY noise.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
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

// Mock the extractors so the `run` wiring tests can assert which options
// reach them without a real Bazel toolchain.
vi.mock(
  import('../../../../../src/commands/manifest/bazel/extract_bazel_to_maven.mts'),
  () => ({
    extractBazelToMaven: vi.fn(async () => ({
      artifactCount: 1,
      complete: true,
      manifestPaths: ['/tmp/maven_install.json'],
      status: 'complete',
      workspaceOutcomes: [],
    })),
  }),
)
vi.mock(
  import('../../../../../src/commands/manifest/bazel/extract_bazel_to_pypi.mts'),
  () => ({
    extractBazelToPypi: vi.fn(async () => ({
      artifactCount: 0,
      noEcosystemFound: true,
      ok: false,
    })),
  }),
)

import {
  cmdManifestBazel,
  evaluateEcosystemOutcomes,
} from '../../../../../src/commands/manifest/bazel/cmd-manifest-bazel.mts'
import { extractBazelToMaven } from '../../../../../src/commands/manifest/bazel/extract_bazel_to_maven.mts'
import { extractBazelToPypi } from '../../../../../src/commands/manifest/bazel/extract_bazel_to_pypi.mts'

import type { EcosystemOutcome } from '../../../../../src/commands/manifest/bazel/cmd-manifest-bazel.mts'
import type { CliCommandContext } from '../../../../../src/util/cli/with-subcommands.mjs'

const importMeta = {
  url: 'file:///cmd-manifest-bazel.test.mts',
} as ImportMeta

const context = { parentName: 'manifest' } as CliCommandContext

function auto(outcomes: EcosystemOutcome[]): void {
  evaluateEcosystemOutcomes(outcomes, { isExplicit: false })
}

function explicit(outcomes: EcosystemOutcome[]): void {
  evaluateEcosystemOutcomes(outcomes, { isExplicit: true })
}

const COMPLETE_MAVEN: EcosystemOutcome = {
  complete: true,
  ecosystem: 'maven',
  manifestPaths: ['/tmp/maven_install.json'],
  status: 'complete',
}
const COMPLETE_PYPI: EcosystemOutcome = {
  complete: true,
  ecosystem: 'pypi',
  manifestPaths: ['/tmp/requirements.txt'],
  status: 'complete',
}
const NO_MAVEN: EcosystemOutcome = {
  complete: false,
  ecosystem: 'maven',
  manifestPaths: [],
  status: 'noEcosystem',
}
const NO_PYPI: EcosystemOutcome = {
  complete: false,
  ecosystem: 'pypi',
  manifestPaths: [],
  status: 'noEcosystem',
}
const HARDFAIL_MAVEN: EcosystemOutcome = {
  complete: false,
  ecosystem: 'maven',
  manifestPaths: [],
  status: 'hardFailure',
}
const HARDFAIL_PYPI: EcosystemOutcome = {
  complete: false,
  ecosystem: 'pypi',
  manifestPaths: [],
  status: 'hardFailure',
}
const PARTIAL_MAVEN: EcosystemOutcome = {
  complete: false,
  ecosystem: 'maven',
  manifestPaths: ['/tmp/maven_install.json'],
  status: 'partial',
}

describe('cmd-manifest-bazel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('describes the Bazel SBOM support', () => {
      expect(cmdManifestBazel.description).toContain('Bazel')
      expect(cmdManifestBazel.hidden).toBe(false)
    })
  })

  describe('dry-run', () => {
    it('exits without invoking any extractor', async () => {
      await cmdManifestBazel.run(['--dry-run', '.'], importMeta, context)
      expect(extractBazelToMaven).not.toHaveBeenCalled()
      expect(extractBazelToPypi).not.toHaveBeenCalled()
    })

    it('accepts --ecosystem pypi with dry-run', async () => {
      await cmdManifestBazel.run(
        ['--ecosystem', 'pypi', '--dry-run', '.'],
        importMeta,
        context,
      )
      expect(extractBazelToPypi).not.toHaveBeenCalled()
    })

    it('accepts repeatable --ecosystem with dry-run', async () => {
      await cmdManifestBazel.run(
        ['--ecosystem', 'maven', '--ecosystem', 'pypi', '--dry-run', '.'],
        importMeta,
        context,
      )
      expect(extractBazelToMaven).not.toHaveBeenCalled()
      expect(extractBazelToPypi).not.toHaveBeenCalled()
    })
  })

  describe('evaluateEcosystemOutcomes (auto-detect mode)', () => {
    it('returns void when at least one ecosystem produced output and none hard-failed', () => {
      expect(() => auto([COMPLETE_MAVEN, NO_PYPI])).not.toThrow()
    })

    it('tolerates absent Maven when PyPI produced output in auto mode', () => {
      expect(() => auto([NO_MAVEN, COMPLETE_PYPI])).not.toThrow()
    })

    it('counts a partial run as produced output (with a warning)', () => {
      expect(() => auto([PARTIAL_MAVEN, NO_PYPI])).not.toThrow()
    })

    it('uploads and warns on a mixed Maven-partial + PyPI-complete run', () => {
      expect(() => auto([PARTIAL_MAVEN, COMPLETE_PYPI])).not.toThrow()
    })

    it('throws when a hard failure occurs even if another ecosystem succeeded', () => {
      expect(() => auto([COMPLETE_MAVEN, HARDFAIL_PYPI])).toThrowError(
        /hard failure\(s\) in ecosystem\(s\): pypi/,
      )
    })

    it('throws when no ecosystem was detected at all', () => {
      expect(() => auto([NO_MAVEN, NO_PYPI])).toThrowError(
        /No supported Bazel ecosystems detected/,
      )
    })

    it('throws when every attempted ecosystem hard-failed', () => {
      expect(() => auto([HARDFAIL_MAVEN, HARDFAIL_PYPI])).toThrowError(
        /hard failure\(s\) in ecosystem\(s\): maven, pypi/,
      )
    })

    it('supports Maven-only default auto mode', () => {
      expect(() => auto([COMPLETE_MAVEN])).not.toThrow()
    })
  })

  describe('evaluateEcosystemOutcomes (explicit mode)', () => {
    it('returns void when every requested ecosystem produced output', () => {
      expect(() => explicit([COMPLETE_MAVEN, COMPLETE_PYPI])).not.toThrow()
    })

    it('counts a partial run as success in explicit mode (with a warning)', () => {
      expect(() => explicit([PARTIAL_MAVEN])).not.toThrow()
    })

    it('throws InputError when a requested ecosystem is absent (noEcosystem)', () => {
      expect(() => explicit([NO_PYPI])).toThrowError(
        /No Bazel rules found for explicitly requested ecosystem\(s\): pypi/,
      )
    })

    it('throws InputError when a requested ecosystem hard-failed (Maven only)', () => {
      expect(() => explicit([HARDFAIL_MAVEN])).toThrowError(
        /Bazel manifest generation failed for explicitly requested ecosystem\(s\): maven/,
      )
    })

    it('throws InputError when explicitly requested Maven is absent', () => {
      expect(() => explicit([NO_MAVEN])).toThrowError(
        /No Bazel rules found for explicitly requested ecosystem\(s\): maven/,
      )
    })

    it('throws when Maven hard-fails even if pypi succeeded', () => {
      expect(() => explicit([HARDFAIL_MAVEN, COMPLETE_PYPI])).toThrowError(
        /Bazel manifest generation failed for explicitly requested ecosystem\(s\): maven/,
      )
    })

    it('exits 0 on partial but emits a prominent warning and a completeness signal', () => {
      expect(() => explicit([PARTIAL_MAVEN])).not.toThrow()
      const warned = mockLogger.warn.mock.calls
        .map(c => String(c[0]))
        .join('\n')
      const informed = mockLogger.info.mock.calls
        .map(c => String(c[0]))
        .join('\n')
      // Prominent partial warning naming the known-incomplete SBOM.
      expect(warned).toMatch(/PARTIAL/)
      expect(warned).toMatch(/known-incomplete/)
      // Machine-readable completeness signal echoed for the produced
      // ecosystem.
      expect(informed).toMatch(/extraction status: partial \(complete=false\)/)
    })

    it('does not flag a complete run as incomplete', () => {
      expect(() => explicit([COMPLETE_MAVEN])).not.toThrow()
      const informed = mockLogger.info.mock.calls
        .map(c => String(c[0]))
        .join('\n')
      expect(informed).toMatch(/extraction status: complete \(complete=true\)/)
    })
  })

  describe('run wiring', () => {
    it('defaults the explicit command to a 120s per-repo timeout', async () => {
      await cmdManifestBazel.run(['.'], importMeta, context)
      expect(extractBazelToMaven).toHaveBeenCalledTimes(1)
      expect(extractBazelToMaven).toHaveBeenCalledWith(
        expect.objectContaining({ perRepoTimeoutMs: 120_000 }),
      )
    })

    it('flows a --per-repo-timeout override through to the extractor', async () => {
      await cmdManifestBazel.run(
        ['--per-repo-timeout', '45000', '.'],
        importMeta,
        context,
      )
      expect(extractBazelToMaven).toHaveBeenCalledWith(
        expect.objectContaining({ perRepoTimeoutMs: 45_000 }),
      )
    })

    it('defaults the output dir to <cwd>/.socket/bazel-manifests', async () => {
      await cmdManifestBazel.run(['.'], importMeta, context)
      const call = vi.mocked(extractBazelToMaven).mock.calls[0]![0]
      expect(call.out.endsWith(`.socket/bazel-manifests`)).toBe(true)
    })

    it('rejects an unsupported --ecosystem value', async () => {
      await expect(
        cmdManifestBazel.run(
          ['--ecosystem', 'cargo', '.'],
          importMeta,
          context,
        ),
      ).rejects.toThrow(/Unsupported --ecosystem value: cargo/)
    })

    it('dispatches pypi when explicitly requested', async () => {
      vi.mocked(extractBazelToPypi).mockResolvedValueOnce({
        artifactCount: 1,
        manifestPath: '/tmp/requirements.txt',
        ok: true,
      })
      await cmdManifestBazel.run(
        ['.', '--ecosystem', 'pypi'],
        importMeta,
        context,
      )
      expect(extractBazelToPypi).toHaveBeenCalledTimes(1)
      expect(extractBazelToMaven).not.toHaveBeenCalled()
    })
  })
})
