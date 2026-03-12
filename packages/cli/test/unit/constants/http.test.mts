/**
 * Unit tests for HTTP constants.
 *
 * Purpose:
 * Tests the HTTP status code constants.
 *
 * Test Coverage:
 * - HTTP status code constants
 * - NPM registry URL
 *
 * Related Files:
 * - constants/http.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_FORBIDDEN,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  HTTP_STATUS_UNAUTHORIZED,
  NPM_REGISTRY_URL,
} from '../../../src/constants/http.mts'

describe('http constants', () => {
  describe('HTTP status code constants', () => {
    it('has HTTP_STATUS_BAD_REQUEST constant', () => {
      expect(HTTP_STATUS_BAD_REQUEST).toBe(400)
    })

    it('has HTTP_STATUS_UNAUTHORIZED constant', () => {
      expect(HTTP_STATUS_UNAUTHORIZED).toBe(401)
    })

    it('has HTTP_STATUS_FORBIDDEN constant', () => {
      expect(HTTP_STATUS_FORBIDDEN).toBe(403)
    })

    it('has HTTP_STATUS_NOT_FOUND constant', () => {
      expect(HTTP_STATUS_NOT_FOUND).toBe(404)
    })

    it('has HTTP_STATUS_TOO_MANY_REQUESTS constant', () => {
      expect(HTTP_STATUS_TOO_MANY_REQUESTS).toBe(429)
    })

    it('has HTTP_STATUS_INTERNAL_SERVER_ERROR constant', () => {
      expect(HTTP_STATUS_INTERNAL_SERVER_ERROR).toBe(500)
    })
  })

  describe('HTTP status code ranges', () => {
    it('4xx codes are client errors', () => {
      expect(HTTP_STATUS_BAD_REQUEST).toBeGreaterThanOrEqual(400)
      expect(HTTP_STATUS_BAD_REQUEST).toBeLessThan(500)
      expect(HTTP_STATUS_UNAUTHORIZED).toBeGreaterThanOrEqual(400)
      expect(HTTP_STATUS_UNAUTHORIZED).toBeLessThan(500)
      expect(HTTP_STATUS_FORBIDDEN).toBeGreaterThanOrEqual(400)
      expect(HTTP_STATUS_FORBIDDEN).toBeLessThan(500)
      expect(HTTP_STATUS_NOT_FOUND).toBeGreaterThanOrEqual(400)
      expect(HTTP_STATUS_NOT_FOUND).toBeLessThan(500)
      expect(HTTP_STATUS_TOO_MANY_REQUESTS).toBeGreaterThanOrEqual(400)
      expect(HTTP_STATUS_TOO_MANY_REQUESTS).toBeLessThan(500)
    })

    it('5xx codes are server errors', () => {
      expect(HTTP_STATUS_INTERNAL_SERVER_ERROR).toBeGreaterThanOrEqual(500)
      expect(HTTP_STATUS_INTERNAL_SERVER_ERROR).toBeLessThan(600)
    })
  })

  describe('registry URL', () => {
    it('has NPM_REGISTRY_URL constant', () => {
      expect(NPM_REGISTRY_URL).toContain('registry')
      expect(NPM_REGISTRY_URL).toContain('npm')
    })
  })
})
