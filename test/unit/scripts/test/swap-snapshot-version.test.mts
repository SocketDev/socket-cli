import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SNAPSHOT_DEPENDENCIES,
  readPinnedVersion,
} from '../../../../scripts/test/snapshot-dependencies.mts'
import {
  parseSwapArgs,
  swapVersionInSnapshot,
} from '../../../../scripts/test/swap-snapshot-version.mts'

const ROW = '<tspan>  Default: 15.15.0.        </tspan>'

describe('swapVersionInSnapshot', () => {
  it('keeps the row width when the version grows or shrinks', () => {
    expect(swapVersionInSnapshot(ROW, '15.15.0', '15.15.10')).toBe(
      '<tspan>  Default: 15.15.10.       </tspan>',
    )
    expect(swapVersionInSnapshot(ROW, '15.15.0', '9.0.0')).toBe(
      '<tspan>  Default: 9.0.0.          </tspan>',
    )
  })

  it('leaves longer versions that start with the old one alone', () => {
    expect(() =>
      swapVersionInSnapshot('Default: 15.15.01. ', '15.15.0', '15.16.0'),
    ).toThrow('does not mention 15.15.0')
    expect(() =>
      swapVersionInSnapshot('Default: 15.15.0.1 ', '15.15.0', '15.16.0'),
    ).toThrow('does not mention 15.15.0')
  })

  it('refuses a version too long for the row', () => {
    expect(() =>
      swapVersionInSnapshot('Default: 1.0.0.</tspan>', '1.0.0', '10.0.0'),
    ).toThrow('No room in the row')
  })

  it('round-trips the checked-in Coana snapshots', async () => {
    const pinned = await readPinnedVersion(SNAPSHOT_DEPENDENCIES.coana)
    for (const snapshot of SNAPSHOT_DEPENDENCIES.coana.snapshots) {
      const contents = readFileSync(path.join(process.cwd(), snapshot), 'utf8')
      const moved = swapVersionInSnapshot(contents, pinned, '99.99.999')
      expect(moved).toHaveLength(contents.length)
      expect(moved).not.toContain(pinned)
      expect(swapVersionInSnapshot(moved, '99.99.999', pinned)).toBe(contents)
    }
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
