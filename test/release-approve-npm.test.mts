import { describe, expect, it } from 'vitest'

import {
  pnpmStageInvocation,
  stageActionForStatus,
  validateStage,
} from '../scripts/release/approve-npm.mts'
import { releasePackagesForVersion } from '../scripts/release/packages.mts'

const policy = {
  mode: 'prerelease-only',
  identifier: 'rc',
  versionHint: '2.1.0',
  distTag: 'rc-2.1.0',
} as const

const id = '12345678-1234-4123-8123-123456789abc'

describe('npm stage approval', () => {
  it('validates stage identity and supported release package names', () => {
    expect(
      validateStage(
        {
          id,
          packageName: 'socket',
          version: '1.14.2',
          tag: 'latest',
          status: 'staged',
        },
        id,
        policy,
      ),
    ).toEqual({ name: 'socket', version: '1.14.2' })
    expect(() =>
      validateStage(
        { id, packageName: 'other', version: '1.14.2' },
        id,
        policy,
      ),
    ).toThrow('Unexpected npm package')
    expect(() =>
      validateStage({ id, packageName: 'socket', version: 'bad' }, id, policy),
    ).toThrow('stage ID, package, or version is invalid')
    expect(() =>
      validateStage(
        { id, packageName: '@socketsecurity/cli', version: '2.1.0-rc.2' },
        id,
        policy,
      ),
    ).toThrow('Unexpected npm package')
  })

  it('checks the immutable npm tag for each prerelease package before approval', () => {
    for (const packageName of releasePackagesForVersion('2.1.0-rc.2')) {
      const stage = {
        id,
        packageName,
        version: '2.1.0-rc.2',
        status: 'awaiting_approval',
      }
      expect(validateStage({ ...stage, tag: 'rc-2.1.0' }, id, policy)).toEqual({
        name: packageName,
        version: stage.version,
      })
      for (const tag of ['latest', undefined]) {
        expect(() => validateStage({ ...stage, tag }, id, policy)).toThrow(
          'Expected npm stage dist-tag rc-2.1.0',
        )
      }
    }
  })

  it('maps npm states to safe retry, approval, finalization, and burn actions', () => {
    expect(stageActionForStatus('validating')).toBe('wait')
    expect(stageActionForStatus('staged')).toBe('approve')
    expect(stageActionForStatus('awaiting_approval')).toBe('approve')
    expect(stageActionForStatus('published')).toBe('finalize')
    expect(stageActionForStatus('blocked')).toBe('burned')
    expect(stageActionForStatus('deleted')).toBe('burned')
    expect(() => stageActionForStatus('unknown')).toThrow(
      'npm stage is unknown; approval stopped',
    )
  })

  it('waits for every stable package but all native packages for prereleases', () => {
    expect(releasePackagesForVersion('1.14.2')).toEqual([
      'socket',
      '@socketsecurity/cli',
      '@socketsecurity/cli-with-sentry',
    ])
    expect(releasePackagesForVersion('2.1.0-rc.2')).toEqual([
      'socket',
      '@socketsecurity/socket-cli-darwin-arm64',
      '@socketsecurity/socket-cli-linux-arm64',
      '@socketsecurity/socket-cli-linux-x64',
      '@socketsecurity/socket-cli-win32-arm64',
      '@socketsecurity/socket-cli-win32-x64',
    ])
  })

  it('uses the pinned pnpm for stage commands', () => {
    expect(pnpmStageInvocation('10.33.0', ['stage', 'view', id])).toEqual({
      command: 'corepack',
      args: ['pnpm@12.22.0', '--pm-on-fail=ignore', 'stage', 'view', id],
    })
    expect(pnpmStageInvocation('12.22.0', ['stage', 'view', id])).toEqual({
      command: 'pnpm',
      args: ['stage', 'view', id],
    })
  })
})
