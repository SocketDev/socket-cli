import { afterEach, describe, expect, it } from 'vitest'

import {
  applyLogout,
  CMD_NAME,
  cmdLogout,
} from '../../../../src/command/logout/cmd-logout.mts'
import {
  getConfigValues,
  overrideCachedConfig,
  resetConfigForTesting,
} from '../../../../src/util/config.mts'

afterEach(() => resetConfigForTesting())

describe('logout', () => {
  it('exposes the logout command', () => {
    expect(CMD_NAME).toBe('logout')
    expect(cmdLogout.hidden).toBe(false)
    expect(typeof cmdLogout.run).toBe('function')
  })

  it('clears credentials while preserving unrelated preferences', async () => {
    overrideCachedConfig(
      JSON.stringify({
        apiToken: 'REDACTED_TEST_TOKEN',
        apiBaseUrl: 'https://api.example.com',
        apiProxy: 'https://proxy.example.com',
        enforcedOrgs: ['example-org'],
        defaultOrg: 'example-org',
      }),
    )
    await applyLogout()
    const config = getConfigValues()
    expect(config.apiToken).toBeUndefined()
    expect(config.apiBaseUrl).toBeUndefined()
    expect(config.apiProxy).toBeUndefined()
    expect(config.enforcedOrgs).toBeUndefined()
    expect(config.defaultOrg).toBe('example-org')
  })

  it('is idempotent without configured credentials', async () => {
    overrideCachedConfig('{}')
    await applyLogout()
    await applyLogout()
    expect(getConfigValues().apiToken).toBeUndefined()
  })
})
