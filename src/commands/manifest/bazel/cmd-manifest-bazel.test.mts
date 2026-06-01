import { describe, expect, it } from 'vitest'

import { evaluateEcosystemOutcomes } from './cmd-manifest-bazel.mts'
import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
} from '../../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../../test/utils.mts'

import type { EcosystemOutcome } from './cmd-manifest-bazel.mts'

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
  ecosystem: 'maven',
  manifestPaths: ['/tmp/maven_install.json'],
  status: 'complete',
}
const COMPLETE_PYPI: EcosystemOutcome = {
  ecosystem: 'pypi',
  manifestPaths: ['/tmp/requirements.txt'],
  status: 'complete',
}
const NO_MAVEN: EcosystemOutcome = {
  ecosystem: 'maven',
  manifestPaths: [],
  status: 'noEcosystem',
}
const NO_PYPI: EcosystemOutcome = {
  ecosystem: 'pypi',
  manifestPaths: [],
  status: 'noEcosystem',
}
const HARDFAIL_MAVEN: EcosystemOutcome = {
  ecosystem: 'maven',
  manifestPaths: [],
  status: 'hardFailure',
}
const HARDFAIL_PYPI: EcosystemOutcome = {
  ecosystem: 'pypi',
  manifestPaths: [],
  status: 'hardFailure',
}
const PARTIAL_MAVEN: EcosystemOutcome = {
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
})
