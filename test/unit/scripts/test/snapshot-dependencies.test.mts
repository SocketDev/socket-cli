import { describe, expect, it } from 'vitest'

import {
  findStaleSnapshotDependencies,
  snapshotDependencyUpdateHint,
} from '../../../../scripts/test/snapshot-dependencies.mts'

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
