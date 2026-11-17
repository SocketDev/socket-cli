import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SNAPSHOT_DEPENDENCIES,
  readPinnedVersion,
  swapVersionInSnapshot,
} from '../../../../scripts/test/snapshot-dependencies.mts'
import { parseSwapArgs } from '../../../../scripts/test/swap-snapshot-version.mts'

describe('Coana snapshots', () => {
  it('round-trips the checked-in Coana snapshots', async () => {
    const pinned = await readPinnedVersion(SNAPSHOT_DEPENDENCIES.coana)
    await Promise.all(
      SNAPSHOT_DEPENDENCIES.coana.snapshots.map(async snapshot => {
        const contents = await readFile(
          path.join(process.cwd(), snapshot),
          'utf8',
        )
        const moved = swapVersionInSnapshot(contents, pinned, '99.99.999')
        expect(moved).toHaveLength(contents.length)
        expect(moved).not.toContain(pinned)
        expect(swapVersionInSnapshot(moved, '99.99.999', pinned)).toBe(contents)
      }),
    )
  })
})

describe('parseSwapArgs', () => {
  it('reads --dep and --from', () => {
    expect(parseSwapArgs(['--dep', 'coana', '--from', '15.15.0'])).toEqual({
      dependencyName: 'coana',
      from: '15.15.0',
    })
  })

  it('needs both flags', () => {
    expect(() => parseSwapArgs(['--dep', 'coana'])).toThrow('Pass both')
    expect(() => parseSwapArgs(['--to', '1.0.0'])).toThrow(
      "Unknown option '--to'",
    )
  })
})
