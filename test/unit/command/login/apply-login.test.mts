import { afterEach, describe, expect, it } from 'vitest'

import { applyLogin } from '../../../../src/command/login/apply-login.mts'
import {
  getConfigValues,
  overrideCachedConfig,
  resetConfigForTesting,
} from '../../../../src/util/config.mts'

const apiToken = 'REDACTED_TEST_TOKEN'

afterEach(() => resetConfigForTesting())

describe('applyLogin', () => {
  it('updates credentials and organization configuration together', async () => {
    overrideCachedConfig('{}')
    await applyLogin(
      apiToken,
      ['example-org'],
      'https://api.example.com',
      undefined,
    )
    expect(getConfigValues()).toMatchObject({
      apiToken,
      enforcedOrgs: ['example-org'],
      apiBaseUrl: 'https://api.example.com',
    })
  })

  it('clears optional values when a new login omits them', async () => {
    overrideCachedConfig(
      JSON.stringify({ apiProxy: 'https://proxy.example.com' }),
    )
    await applyLogin(apiToken, [], undefined, undefined)
    expect(getConfigValues().apiProxy).toBeUndefined()
    expect(getConfigValues().apiBaseUrl).toBeUndefined()
    expect(getConfigValues().enforcedOrgs).toEqual([])
  })

  it('refuses to persist a device session under a config override', async () => {
    overrideCachedConfig('{}')
    await expect(
      applyLogin(apiToken, [], undefined, undefined, {
        options: {
          issuer: 'https://api.example.com/v1/oauth2/',
          clientId: 'socket-cli',
        },
        tokens: {
          accessToken: apiToken,
          tokenType: 'Bearer',
          expiresIn: 900,
          refreshToken: 'REDACTED_TEST_REFRESH_TOKEN',
        },
      }),
    ).rejects.toThrow()
    expect(getConfigValues().apiToken).toBeUndefined()
  })
})
