import { describe, expect, it, vi } from 'vitest'

import { runReleasePromotion } from '../scripts/release/promote.mts'

function promotionDependencies() {
  return {
    discard: vi.fn(async () => {}),
    promote: vi.fn(async () => {}),
    resolveEnv: vi.fn(() => ({
      releaseLine: 'v1.x',
      repo: 'fixture/release-cli',
      token: 'placeholder',
    })),
  }
}

describe('release promotion lifecycle', () => {
  it('discards a failed build branch without a verification SHA', async () => {
    const dependencies = promotionDependencies()
    await runReleasePromotion(
      ['--branch', 'npm-publish-v1.1.177', '--discard'],
      dependencies,
    )
    expect(dependencies.discard).toHaveBeenCalledExactlyOnceWith({
      branch: 'npm-publish-v1.1.177',
      env: dependencies.resolveEnv.mock.results[0]!.value,
      version: '1.1.177',
    })
    expect(dependencies.promote).not.toHaveBeenCalled()
  })

  it('promotes the verified bump SHA on successful staging', async () => {
    const dependencies = promotionDependencies()
    await runReleasePromotion(
      ['--branch', 'npm-publish-v1.1.177', '--sha', 'abc1234'],
      dependencies,
    )
    expect(dependencies.promote).toHaveBeenCalledExactlyOnceWith(
      {
        branch: 'npm-publish-v1.1.177',
        env: dependencies.resolveEnv.mock.results[0]!.value,
        version: '1.1.177',
      },
      'abc1234',
    )
    expect(dependencies.discard).not.toHaveBeenCalled()
  })

  it.each([
    ['--branch', 'npm-publish-v1.1.177'],
    ['--sha', 'abc1234'],
    ['--branch', '--discard'],
    ['--discard'],
  ])(
    'rejects missing required inputs before resolving credentials: %j',
    async (...argv) => {
      const dependencies = promotionDependencies()
      await expect(
        runReleasePromotion(argv, dependencies),
      ).rejects.toBeInstanceOf(Error)
      expect(dependencies.resolveEnv).not.toHaveBeenCalled()
      expect(dependencies.discard).not.toHaveBeenCalled()
      expect(dependencies.promote).not.toHaveBeenCalled()
    },
  )

  it('propagates a failed discard for workflow recovery', async () => {
    const dependencies = promotionDependencies()
    const failure = new Error('fixture deletion failure')
    dependencies.discard.mockRejectedValueOnce(failure)
    await expect(
      runReleasePromotion(
        ['--branch', 'npm-publish-v1.1.177', '--discard'],
        dependencies,
      ),
    ).rejects.toBe(failure)
    expect(dependencies.promote).not.toHaveBeenCalled()
  })
})
