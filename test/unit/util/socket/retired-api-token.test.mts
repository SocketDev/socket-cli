import { describe, expect, it } from 'vitest'

import { SOCKET_PUBLIC_API_TOKEN } from '../../../../src/constants/socket.mts'
import {
  isRetiredSocketApiToken,
  RetiredSocketApiTokenError,
} from '../../../../src/util/socket/retired-api-token.mts'

describe('retired Socket API token detection', () => {
  it('recognizes the retired source value and surrounding whitespace', () => {
    expect(isRetiredSocketApiToken(SOCKET_PUBLIC_API_TOKEN)).toBe(true)
    expect(isRetiredSocketApiToken(` \t${SOCKET_PUBLIC_API_TOKEN}\n `)).toBe(
      true,
    )
  })

  it('does not match blank, absent, similar, or ordinary tokens', () => {
    expect(isRetiredSocketApiToken(undefined)).toBe(false)
    expect(isRetiredSocketApiToken('')).toBe(false)
    expect(isRetiredSocketApiToken(' \t\n ')).toBe(false)
    const changedCharacter = `${SOCKET_PUBLIC_API_TOKEN.slice(0, -1)}x`
    expect(isRetiredSocketApiToken(changedCharacter)).toBe(false)
    expect(isRetiredSocketApiToken('sktsec_t_synthetic-negative-test')).toBe(
      false,
    )
    expect(isRetiredSocketApiToken('sktsec_synthetic-user-token')).toBe(false)
  })

  it('uses a static diagnostic with a stable coded error', () => {
    const error = new RetiredSocketApiTokenError()
    expect(error.code).toBe('SOCKET_RETIRED_API_TOKEN')
    expect(error.message).toContain('socket login')
  })
})
