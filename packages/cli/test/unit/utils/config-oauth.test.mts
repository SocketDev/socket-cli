import { describe, expect, it } from 'vitest'

import {
  getSupportedConfigKeys,
  isSensitiveConfigKey,
} from '../../../src/utils/config.mts'

describe('utils/config (oauth keys)', () => {
  it('includes oauth-related config keys', () => {
    const keys = getSupportedConfigKeys()
    expect(keys).toContain('authBaseUrl')
    expect(keys).toContain('oauthClientId')
    expect(keys).toContain('oauthRedirectUri')
    expect(keys).toContain('oauthRefreshToken')
    expect(keys).toContain('oauthScopes')
    expect(keys).toContain('oauthTokenExpiresAt')
  })

  it('treats oauthRefreshToken as sensitive', () => {
    expect(isSensitiveConfigKey('oauthRefreshToken')).toBe(true)
  })
})
