import { afterEach, describe, expect, it, vi } from 'vitest'

import constants from '../../../scripts/constants.js'

describe('Rollup constants', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads the configured Socket CLI version for bundle replacement', () => {
    vi.stubEnv('INLINED_SOCKET_CLI_VERSION', '2.1.0-rc.0')

    expect(constants.ENV.INLINED_SOCKET_CLI_VERSION).toBe('2.1.0-rc.0')
  })
})
