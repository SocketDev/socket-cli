import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@socketsecurity/registry/lib/logger'

// Mock the extractor so the `run` wiring test can assert which timeout reaches
// it without a real Bazel toolchain. The `cmdit`/spawnSocketCli tests below
// run in a child process and are unaffected by these in-process mocks.
vi.mock('./extract_bazel_to_maven.mts', () => ({
  extractBazelToMaven: vi.fn(async () => ({
    artifactCount: 1,
    complete: true,
    manifestPaths: ['/tmp/maven_install.json'],
    status: 'complete',
    workspaceOutcomes: [],
  })),
}))
vi.mock('./extract_bazel_to_pypi.mts', () => ({
  extractBazelToPypi: vi.fn(async () => ({
    noEcosystemFound: true,
    ok: false,
  })),
}))

import {
  cmdManifestBazel,
  evaluateEcosystemOutcomes,
} from './cmd-manifest-bazel.mts'
import { extractBazelToMaven } from './extract_bazel_to_maven.mts'
import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
} from '../../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../../test/utils.mts'

import type { EcosystemOutcome } from './cmd-manifest-bazel.mts'
import type { CliCommandContext } from '../../../utils/meow-with-subcommands.mts'

describe('socket manifest bazel', async () => {
  const { binCliPath } = constants

  cmdit(
    ['manifest', 'bazel', FLAG_DRY_RUN, FLAG_CONFIG, '{}'],
    'should exit 0 with dry-run (no bazel on PATH)',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd)
      expect(code, 'dry-run should exit with code 0').toBe(0)
    },
  )

  cmdit(
    [
      'manifest',
      'bazel',
      '--ecosystem',
      'pypi',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{}',
    ],
    'should accept --ecosystem pypi with dry-run',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd)
      expect(
        code,
        'dry-run with --ecosystem pypi should exit with code 0',
      ).toBe(0)
    },
  )

  cmdit(
    [
      'manifest',
      'bazel',
      '--ecosystem',
      'maven',
      '--ecosystem',
      'pypi',
      FLAG_DRY_RUN,
      FLAG_CONFIG,
      '{}',
    ],
    'should accept repeatable --ecosystem with dry-run',
    async cmd => {
      const { code } = await spawnSocketCli(binCliPath, cmd)
      expect(
        code,
        'dry-run with repeatable --ecosystem should exit with code 0',
      ).toBe(0)
    },
  )
})

const auto = (outcomes: EcosystemOutcome[]) =>
  evaluateEcosystemOutcomes(outcomes, false)

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

const explicit = (outcomes: EcosystemOutcome[]) =>
  evaluateEcosystemOutcomes(outcomes, true)

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
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger)
    try {
      expect(() => explicit([PARTIAL_MAVEN])).not.toThrow()
      const warned = warnSpy.mock.calls.map(c => String(c[0])).join('\n')
      const informed = infoSpy.mock.calls.map(c => String(c[0])).join('\n')
      // Prominent partial warning naming the known-incomplete SBOM.
      expect(warned).toMatch(/PARTIAL/)
      expect(warned).toMatch(/known-incomplete/)
      // Machine-readable completeness signal echoed for the produced ecosystem.
      expect(informed).toMatch(/extraction status: partial \(complete=false\)/)
    } finally {
      warnSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })

  it('does not flag a complete run as incomplete', () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger)
    try {
      expect(() => explicit([COMPLETE_MAVEN])).not.toThrow()
      const informed = infoSpy.mock.calls.map(c => String(c[0])).join('\n')
      expect(informed).toMatch(/extraction status: complete \(complete=true\)/)
    } finally {
      infoSpy.mockRestore()
    }
  })
})

describe('perRepoTimeout flag wiring', () => {
  const importMeta = {
    url: 'file:///cmd-manifest-bazel.test.mts',
  } as ImportMeta

  beforeEach(() => {
    vi.mocked(extractBazelToMaven).mockClear()
  })

  it('defaults the explicit command to a 120s per-repo timeout', async () => {
    await cmdManifestBazel.run([FLAG_CONFIG, '{}', '.'], importMeta, {
      parentName: 'manifest',
    } as CliCommandContext)
    expect(extractBazelToMaven).toHaveBeenCalledTimes(1)
    expect(extractBazelToMaven).toHaveBeenCalledWith(
      expect.objectContaining({ perRepoTimeoutMs: 120_000 }),
    )
  })

  it('flows a --per-repo-timeout override through to the extractor', async () => {
    await cmdManifestBazel.run(
      ['--per-repo-timeout', '45000', FLAG_CONFIG, '{}', '.'],
      importMeta,
      { parentName: 'manifest' } as CliCommandContext,
    )
    expect(extractBazelToMaven).toHaveBeenCalledWith(
      expect.objectContaining({ perRepoTimeoutMs: 45_000 }),
    )
  })
})
