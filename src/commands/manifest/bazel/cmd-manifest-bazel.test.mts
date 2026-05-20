import { describe, expect, it } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
} from '../../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../../test/utils.mts'
import { evaluateEcosystemOutcomes } from './cmd-manifest-bazel.mts'

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

describe('evaluateEcosystemOutcomes (auto-detect mode)', () => {
  const auto = (outcomes: EcosystemOutcome[]) =>
    evaluateEcosystemOutcomes(outcomes, false)

  it('returns void when at least one ecosystem succeeds and none hard-failed', () => {
    expect(() =>
      auto([
        {
          ecosystem: 'maven',
          ok: true,
          manifestPath: '/tmp/maven_install.json',
        },
        { ecosystem: 'pypi', ok: false, noEcosystemFound: true },
      ]),
    ).not.toThrow()
  })

  it('throws when a hard failure occurs even if another ecosystem succeeded', () => {
    expect(() =>
      auto([
        {
          ecosystem: 'maven',
          ok: true,
          manifestPath: '/tmp/maven_install.json',
        },
        { ecosystem: 'pypi', ok: false, noEcosystemFound: false },
      ]),
    ).toThrowError(/hard failure\(s\) in ecosystem\(s\): pypi/)
  })

  it('throws when no ecosystem was detected at all', () => {
    expect(() =>
      auto([
        { ecosystem: 'maven', ok: false, noEcosystemFound: true },
        { ecosystem: 'pypi', ok: false, noEcosystemFound: true },
      ]),
    ).toThrowError(/No supported Bazel ecosystems detected/)
  })

  it('throws when every attempted ecosystem hard-failed', () => {
    expect(() =>
      auto([
        { ecosystem: 'maven', ok: false, noEcosystemFound: false },
        { ecosystem: 'pypi', ok: false, noEcosystemFound: false },
      ]),
    ).toThrowError(/hard failure\(s\) in ecosystem\(s\): maven, pypi/)
  })
})

describe('evaluateEcosystemOutcomes (explicit mode)', () => {
  const explicit = (outcomes: EcosystemOutcome[]) =>
    evaluateEcosystemOutcomes(outcomes, true)

  it('returns void when every requested ecosystem succeeded', () => {
    expect(() =>
      explicit([
        {
          ecosystem: 'maven',
          ok: true,
          manifestPath: '/tmp/maven_install.json',
        },
        {
          ecosystem: 'pypi',
          ok: true,
          manifestPath: '/tmp/requirements.txt',
        },
      ]),
    ).not.toThrow()
  })

  it('throws InputError when a requested ecosystem reports noEcosystemFound', () => {
    expect(() =>
      explicit([
        { ecosystem: 'pypi', ok: false, noEcosystemFound: true },
      ]),
    ).toThrowError(/No Bazel rules found for explicitly requested ecosystem\(s\): pypi/)
  })

  it('throws InputError when a requested ecosystem hard-failed (Maven only)', () => {
    expect(() =>
      explicit([
        { ecosystem: 'maven', ok: false, noEcosystemFound: false },
      ]),
    ).toThrowError(/Bazel manifest generation failed for explicitly requested ecosystem\(s\): maven/)
  })

  it('throws when Maven hard-fails even if pypi succeeded', () => {
    expect(() =>
      explicit([
        { ecosystem: 'maven', ok: false, noEcosystemFound: false },
        {
          ecosystem: 'pypi',
          ok: true,
          manifestPath: '/tmp/requirements.txt',
        },
      ]),
    ).toThrowError(/Bazel manifest generation failed for explicitly requested ecosystem\(s\): maven/)
  })
})
