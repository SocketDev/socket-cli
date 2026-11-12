import { describe, expect, it } from 'vitest'

import {
  packageSetForVersion,
  pnpmStageInvocation,
  stageActionForStatus,
  validateStage,
} from '../scripts/release/approve-npm.mts'
import { releasePackagesForVersion } from '../scripts/release/packages.mts'

const id = '12345678-1234-4123-8123-123456789abc'

describe('npm stage approval', () => {
  it('validates stage identity and supported release package names', () => {
    expect(
      validateStage(
        { id, packageName: 'socket', version: '1.14.2', status: 'staged' },
        id,
      ),
    ).toEqual({ name: 'socket', version: '1.14.2' })
    expect(() =>
      validateStage({ id, packageName: 'other', version: '1.14.2' }, id),
    ).toThrow('Unexpected npm package')
    expect(() =>
      validateStage({ id, packageName: 'socket', version: 'bad' }, id),
    ).toThrow('stage ID, package, or version is invalid')
    expect(() =>
      validateStage(
        { id, packageName: '@socketsecurity/cli', version: '2.1.0-rc.2' },
        id,
      ),
    ).toThrow('Prerelease stages may only contain the socket package')
  })

  it('maps npm states to safe retry, approval, finalization, and burn actions', () => {
    expect(stageActionForStatus('validating')).toBe('wait')
    expect(stageActionForStatus('staged')).toBe('approve')
    expect(stageActionForStatus('published')).toBe('finalize')
    expect(stageActionForStatus('blocked')).toBe('burned')
    expect(stageActionForStatus('deleted')).toBe('burned')
    expect(() => stageActionForStatus('unknown')).toThrow(
      'npm stage is unknown; approval stopped',
    )
  })

  it('waits for every stable package but only socket for prereleases', () => {
    expect(releasePackagesForVersion('1.14.2')).toEqual([
      'socket',
      '@socketsecurity/cli',
      '@socketsecurity/cli-with-sentry',
    ])
    expect(releasePackagesForVersion('2.1.0-rc.2')).toEqual(['socket'])
  })

  it('uses pnpm 11 for stage commands when the workspace pnpm is older', () => {
    expect(pnpmStageInvocation('10.33.0', ['stage', 'view', id])).toEqual({
      command: 'corepack',
      args: ['pnpm@11.17.0', '--pm-on-fail=ignore', 'stage', 'view', id],
    })
    expect(pnpmStageInvocation('11.17.0', ['stage', 'view', id])).toEqual({
      command: 'pnpm',
      args: ['stage', 'view', id],
    })
  })
})
