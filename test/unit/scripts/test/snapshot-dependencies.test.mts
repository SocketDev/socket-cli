import { describe, expect, it } from 'vitest'

import {
  findStaleSnapshotDependencies,
  snapshotContainsVersion,
  snapshotDependencyUpdateHint,
  swapVersionInSnapshot,
} from '../../../../scripts/test/snapshot-dependencies.mts'

describe('swapVersionInSnapshot', () => {
  it('preserves the row width when the version grows or shrinks', () => {
    const row = '<tspan>Default: 15.15.0.        </tspan>'

    expect(swapVersionInSnapshot(row, '15.15.0', '15.15.10')).toBe(
      '<tspan>Default: 15.15.10.       </tspan>',
    )
    expect(swapVersionInSnapshot(row, '15.15.0', '9.0.0')).toBe(
      '<tspan>Default: 9.0.0.          </tspan>',
    )
  })

  it('matches complete versions and rejects suffixes', () => {
    expect(snapshotContainsVersion('Default: 15.15.0. ', '15.15.0')).toBe(true)
    expect(snapshotContainsVersion('Default: 15.15.0-rc.1 ', '15.15.0')).toBe(
      false,
    )
    expect(
      snapshotContainsVersion('Default: 15.15.0+build.1 ', '15.15.0'),
    ).toBe(false)
    expect(snapshotContainsVersion('Default: 15.15.0.1 ', '15.15.0')).toBe(
      false,
    )
    expect(() =>
      swapVersionInSnapshot('Default: 15.15.0-rc.1 ', '15.15.0', '15.16.0'),
    ).toThrow('does not mention 15.15.0')
  })

  it('accepts files already updated by an earlier partial write', () => {
    const row = 'Default: 15.15.10.       '

    expect(swapVersionInSnapshot(row, '15.15.0', '15.15.10')).toBe(row)
  })

  it('fails when the new version does not fit or the old version is absent', () => {
    expect(() =>
      swapVersionInSnapshot('Default: 1.0.0.</tspan>', '1.0.0', '10.0.0'),
    ).toThrow('No room in the row')
    expect(() =>
      swapVersionInSnapshot('Default: 2.0.0 ', '1.0.0', '3.0.0'),
    ).toThrow('does not mention 1.0.0')
  })
})

describe('snapshot dependency hints', () => {
  it('matches pinned Coana and socket-patch versions in their snapshots', async () => {
    await expect(findStaleSnapshotDependencies()).resolves.toEqual([])
  })

  it('lists stale files and the focused refresh command', () => {
    expect(
      snapshotDependencyUpdateHint([
        {
          dependencyName: 'coana',
          packageName: '@coana-tech/cli',
          version: '15.15.0',
          snapshots: ['test/native-snapshots/socket-help-fix.help.svg'],
        },
      ]),
    ).toBe(
      'Snapshot output for @coana-tech/cli@15.15.0 is stale:\n' +
        '  - test/native-snapshots/socket-help-fix.help.svg\n' +
        'Run: pnpm snapshots:update:dep coana',
    )
  })
})
