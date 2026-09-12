import { describe, expect, it } from 'vitest'

import { spawnNode } from '../../../../src/util/spawn/spawn-node.mts'

describe('spawnNode', () => {
  it('runs JavaScript with the current Node interpreter', async () => {
    const result = await spawnNode(
      ['-e', 'process.stdout.write(process.execPath)'],
      { stdio: 'pipe' },
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(process.execPath)
  })

  it('passes explicit environment and captures exit status', async () => {
    const result = await spawnNode(
      [
        '-e',
        'process.stdout.write(process.env.SOCKET_TEST_VALUE);process.exitCode=7',
      ],
      {
        env: { SOCKET_TEST_VALUE: 'fixture-value' },
        stdio: 'pipe',
        throws: false,
      },
    )
    expect(result.code).toBe(7)
    expect(result.stdout).toBe('fixture-value')
  })
})
