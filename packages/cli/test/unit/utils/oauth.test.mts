import { describe, expect, it } from 'vitest'

import {
  deriveAuthBaseUrlFromApiBaseUrl,
  joinUrl,
  normalizeUrlBase,
} from '../../../src/utils/auth/oauth.mts'

describe('utils/auth/oauth', () => {
  describe('normalizeUrlBase', () => {
    it('removes trailing slashes', () => {
      expect(normalizeUrlBase('https://api.socket.dev/')).toBe(
        'https://api.socket.dev',
      )
      expect(normalizeUrlBase('https://api.socket.dev////')).toBe(
        'https://api.socket.dev',
      )
    })
  })

  describe('joinUrl', () => {
    it('joins base + path with single slash', () => {
      expect(joinUrl('https://api.socket.dev/', '/.well-known/test')).toBe(
        'https://api.socket.dev/.well-known/test',
      )
      expect(joinUrl('https://api.socket.dev', '.well-known/test')).toBe(
        'https://api.socket.dev/.well-known/test',
      )
    })
  })

  describe('deriveAuthBaseUrlFromApiBaseUrl', () => {
    it('strips /v0 from API base URL', () => {
      expect(
        deriveAuthBaseUrlFromApiBaseUrl('https://api.socket.dev/v0/'),
      ).toBe('https://api.socket.dev')
      expect(deriveAuthBaseUrlFromApiBaseUrl('https://api.socket.dev/v0')).toBe(
        'https://api.socket.dev',
      )
    })

    it('normalizes trailing slashes and preserves host', () => {
      expect(deriveAuthBaseUrlFromApiBaseUrl('https://api.socket.dev/')).toBe(
        'https://api.socket.dev',
      )
    })

    it('returns undefined for invalid URLs', () => {
      expect(deriveAuthBaseUrlFromApiBaseUrl('not a url')).toBe(undefined)
    })
  })
})
