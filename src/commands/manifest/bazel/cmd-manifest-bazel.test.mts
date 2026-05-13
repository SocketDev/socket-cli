import { describe, expect } from 'vitest'

import constants, {
  FLAG_CONFIG,
  FLAG_DRY_RUN,
} from '../../../../src/constants.mts'
import { cmdit, spawnSocketCli } from '../../../../test/utils.mts'

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
})
