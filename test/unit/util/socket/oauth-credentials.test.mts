import { afterEach, describe, expect, it } from 'vitest'

import {
  overrideCachedConfig,
  resetConfigForTesting,
} from '../../../../src/util/config.mts'
import {
  createOAuthCredentialProvider,
  resolveSdkCredential,
} from '../../../../src/util/socket/sdk.mts'

afterEach(() => resetConfigForTesting())

describe('OAuth credential selection', () => {
  it('preserves explicit API credentials over stored credentials', async () => {
    overrideCachedConfig(JSON.stringify({ apiToken: 'REDACTED_STORED_TOKEN' }))
    expect(
      await resolveSdkCredential({ apiToken: 'REDACTED_EXPLICIT_TOKEN' }),
    ).toEqual({
      ok: true,
      data: { token: 'REDACTED_EXPLICIT_TOKEN', authScheme: 'basic' },
    })
  })

  it('keeps temporary device verification credentials as bearer', async () => {
    overrideCachedConfig('{}')
    expect(
      await resolveSdkCredential({
        apiToken: 'REDACTED_ACCESS_TOKEN',
        authScheme: 'bearer',
      }),
    ).toEqual({
      ok: true,
      data: { token: 'REDACTED_ACCESS_TOKEN', authScheme: 'bearer' },
    })
  })

  it('does not attach refresh behavior to API tokens', () => {
    expect(createOAuthCredentialProvider('basic', undefined)).toBeUndefined()
  })

  it('refuses to continue a command after logout or login replacement', async () => {
    const oauthSession = {
      issuer: 'https://api.example.com/v1/oauth2/',
      clientId: 'socket-cli',
      sessionId: 'original-session',
    }
    overrideCachedConfig(JSON.stringify({ oauthSession }))
    const provider = createOAuthCredentialProvider(
      'bearer',
      'https://api.example.com/v0/',
    )
    expect(provider).toBeTypeOf('function')
    if (!provider) {
      throw new Error('Expected an OAuth credential provider')
    }
    overrideCachedConfig(
      JSON.stringify({
        oauthSession: { ...oauthSession, sessionId: 'new-session' },
      }),
    )
    await expect(provider()).rejects.toThrow()
    overrideCachedConfig('{}')
    await expect(provider()).rejects.toThrow()
  })
})
