import { describe, expect, it } from 'vitest'

import { parseOAuthRefreshResponse } from '../../../../src/util/socket/oauth-refresh.mts'
import { assertOAuthApiOrigin } from '../../../../src/util/socket/oauth-session.mts'
import { socketAuthorizationHeader } from '../../../../src/util/socket/sdk.mts'

const response = {
  access_token: 'REDACTED_TEST_TOKEN',
  expires_in: 900,
  refresh_token: 'REDACTED_TEST_REFRESH_TOKEN',
  token_type: 'Bearer',
}

describe('OAuth refresh validation', () => {
  it('retains the rotated refresh token and lifetime', () => {
    expect(parseOAuthRefreshResponse(200, JSON.stringify(response))).toEqual({
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresIn: 900,
      tokenType: 'Bearer',
    })
  })

  it.each([
    JSON.parse('null'),
    false,
    [],
    {},
    { ...response, expires_in: 0 },
    { ...response, token_type: 'Basic' },
    { ...response, access_token: '' },
    { ...response, refresh_token: '' },
    { ...response, refresh_token: undefined },
    { ...response, expires_in: '900' },
  ])('rejects invalid token responses %#', value => {
    expect(() =>
      parseOAuthRefreshResponse(200, JSON.stringify(value)),
    ).toThrow()
  })

  it('retains an invalid_grant code without reflecting server secrets', () => {
    try {
      parseOAuthRefreshResponse(
        400,
        JSON.stringify({
          error: 'invalid_grant',
          error_description: response.refresh_token,
        }),
      )
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ oauthError: 'invalid_grant' })
      expect(String(error)).not.toContain(response.refresh_token)
    }
  })

  it('binds OAuth access to its issuer origin', () => {
    expect(() =>
      assertOAuthApiOrigin(
        'https://api.example.com/v1/oauth2/',
        'https://api.example.com/v0/',
      ),
    ).not.toThrow()
    expect(() =>
      assertOAuthApiOrigin(
        'https://api.example.com/v1/oauth2/',
        'https://other.example.com/v0/',
      ),
    ).toThrow()
    expect(() =>
      assertOAuthApiOrigin(
        'https://api.example.com/v1/oauth2/',
        'http://api.example.com/v0/',
      ),
    ).toThrow()
  })

  it('uses Bearer for OAuth and Basic for API tokens', () => {
    expect(
      socketAuthorizationHeader({
        token: response.access_token,
        authScheme: 'bearer',
      }),
    ).toBe(`Bearer ${response.access_token}`)
    expect(
      socketAuthorizationHeader({
        token: response.access_token,
        authScheme: 'basic',
      }),
    ).toBe(`Basic ${btoa(`${response.access_token}:`)}`)
  })
})
