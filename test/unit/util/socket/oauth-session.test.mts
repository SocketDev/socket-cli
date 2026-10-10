import { tolerantSleep } from '../../../fleet/_shared/lib/timing.mts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  clearOAuthSession,
  parseOAuthSessionOptions,
  readOAuthSession,
  saveOAuthSession,
  withOAuthSessionLock,
} from '../../../../src/util/socket/oauth-session.mts'
import {
  overrideCachedConfig,
  resetConfigForTesting,
} from '../../../../src/util/config.mts'

const options = {
  clientId: 'socket-cli',
  issuer: 'https://api.example.com/v1/oauth2/',
}

afterEach(() => resetConfigForTesting())

describe('OAuth session', () => {
  it('normalizes the persisted issuer and client', () => {
    expect(
      parseOAuthSessionOptions({
        ...options,
        issuer: 'https://api.example.com/v1/oauth2',
      }),
    ).toEqual(options)
  })

  it('accepts an absent session', () => {
    expect(parseOAuthSessionOptions(undefined)).toBeUndefined()
    expect(parseOAuthSessionOptions(JSON.parse('null'))).toBeUndefined()
  })

  it.each([
    false,
    '',
    {},
    { issuer: 1, clientId: 'socket-cli' },
    { issuer: options.issuer, clientId: '' },
    { issuer: options.issuer, clientId: ' socket-cli' },
    { ...options, issuer: 'http://api.example.com/v1/oauth2/' },
    { ...options, issuer: 'https://user:password@api.example.com/' },
    { ...options, issuer: 'https://api.example.com/?token=example' },
    { ...options, issuer: 'https://api.example.com/#fragment' },
    { ...options, issuer: 'https://127.0.0.1/v1/oauth2/' },
  ])('rejects invalid session metadata %#', value => {
    expect(() => parseOAuthSessionOptions(value)).toThrow()
  })

  it('does not access the keychain under a config override', async () => {
    overrideCachedConfig(JSON.stringify({ oauthSession: options }))
    expect(await readOAuthSession()).toBeUndefined()
    await clearOAuthSession()
    await expect(
      saveOAuthSession(options, {
        accessToken: 'REDACTED_TEST_TOKEN',
        expiresIn: 900,
        refreshToken: 'REDACTED_TEST_REFRESH_TOKEN',
        tokenType: 'Bearer',
      }),
    ).rejects.toThrow()
  })

  it('serializes session changes and releases locks after failure', async () => {
    const order: string[] = []
    const entered = Promise.withResolvers<void>()
    const first = withOAuthSessionLock(async () => {
      order.push('first-start')
      entered.resolve()
      await new Promise(resolve => setTimeout(resolve, tolerantSleep(25)))
      order.push('first-end')
    })
    await entered.promise
    const second = withOAuthSessionLock(async () => {
      order.push('second')
    })
    const results = await Promise.allSettled([first, second])
    expect(results.every(result => result.status === 'fulfilled')).toBe(true)
    expect(order).toEqual(['first-start', 'first-end', 'second'])
    await expect(
      withOAuthSessionLock(async () => {
        throw new Error('example')
      }),
    ).rejects.toThrow()
    expect(await withOAuthSessionLock(async () => 'unlocked')).toBe('unlocked')
  })
})
