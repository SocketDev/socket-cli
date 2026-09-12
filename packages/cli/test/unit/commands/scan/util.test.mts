import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveScanCwd } from '../../../../src/commands/scan/util.mts'

describe('resolveScanCwd', () => {
  const cwd = path.resolve('scan-workspace')

  it.each(['', '.', cwd])('retains the working directory for %s', override => {
    expect(resolveScanCwd(cwd, override)).toBe(cwd)
  })

  it('resolves a relative override from the working directory', () => {
    expect(resolveScanCwd(cwd, 'nested-project')).toBe(
      path.join(cwd, 'nested-project'),
    )
  })

  it('retains an absolute override', () => {
    const override = path.resolve('alternate-project')
    expect(resolveScanCwd(cwd, override)).toBe(override)
  })
})
