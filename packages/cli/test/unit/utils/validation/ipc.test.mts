/**
 * Unit tests for IPC validation utilities.
 *
 * Purpose:
 * Tests the IPC message validation and creation functions.
 *
 * Test Coverage:
 * - isValidIpcMessage function
 * - isValidIpcHandshake function
 * - isValidIpcHandle function
 * - createIpcMessage function
 * - createIpcHandshake function
 * - parseIpcMessage function
 *
 * Related Files:
 * - src/utils/validation/ipc.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  createIpcHandshake,
  createIpcMessage,
  isValidIpcHandle,
  isValidIpcHandshake,
  isValidIpcMessage,
  parseIpcMessage,
} from '../../../../src/utils/validation/ipc.mts'

describe('IPC validation', () => {
  describe('isValidIpcMessage', () => {
    it('returns true for valid IPC message', () => {
      const message = {
        id: 'test-123',
        timestamp: Date.now(),
        type: 'test',
        data: { foo: 'bar' },
      }

      expect(isValidIpcMessage(message)).toBe(true)
    })

    it('returns false for null', () => {
      expect(isValidIpcMessage(null)).toBe(false)
    })

    it('returns false for non-object', () => {
      expect(isValidIpcMessage('string')).toBe(false)
      expect(isValidIpcMessage(123)).toBe(false)
    })

    it('returns false for missing id', () => {
      expect(
        isValidIpcMessage({
          timestamp: Date.now(),
          type: 'test',
          data: {},
        }),
      ).toBe(false)
    })

    it('returns false for empty id', () => {
      expect(
        isValidIpcMessage({
          id: '',
          timestamp: Date.now(),
          type: 'test',
          data: {},
        }),
      ).toBe(false)
    })

    it('returns false for invalid timestamp', () => {
      expect(
        isValidIpcMessage({
          id: 'test',
          timestamp: 0,
          type: 'test',
          data: {},
        }),
      ).toBe(false)
    })

    it('returns false for missing type', () => {
      expect(
        isValidIpcMessage({
          id: 'test',
          timestamp: Date.now(),
          data: {},
        }),
      ).toBe(false)
    })

    it('returns false for empty type', () => {
      expect(
        isValidIpcMessage({
          id: 'test',
          timestamp: Date.now(),
          type: '',
          data: {},
        }),
      ).toBe(false)
    })

    it('returns false for missing data', () => {
      expect(
        isValidIpcMessage({
          id: 'test',
          timestamp: Date.now(),
          type: 'test',
        }),
      ).toBe(false)
    })

    it('accepts null data', () => {
      expect(
        isValidIpcMessage({
          id: 'test',
          timestamp: Date.now(),
          type: 'test',
          data: null,
        }),
      ).toBe(true)
    })
  })

  describe('isValidIpcHandshake', () => {
    it('returns true for valid handshake', () => {
      const handshake = {
        id: 'test-123',
        timestamp: Date.now(),
        type: 'handshake',
        data: {
          version: '1.0.0',
          pid: 12345,
          appName: 'socket',
        },
      }

      expect(isValidIpcHandshake(handshake)).toBe(true)
    })

    it('returns true with optional apiToken', () => {
      const handshake = {
        id: 'test-123',
        timestamp: Date.now(),
        type: 'handshake',
        data: {
          version: '1.0.0',
          pid: 12345,
          appName: 'socket',
          apiToken: 'token-123',
        },
      }

      expect(isValidIpcHandshake(handshake)).toBe(true)
    })

    it('returns false for non-handshake type', () => {
      const message = {
        id: 'test-123',
        timestamp: Date.now(),
        type: 'other',
        data: {
          version: '1.0.0',
          pid: 12345,
          appName: 'socket',
        },
      }

      expect(isValidIpcHandshake(message)).toBe(false)
    })

    it('returns false for missing version', () => {
      expect(
        isValidIpcHandshake({
          id: 'test',
          timestamp: Date.now(),
          type: 'handshake',
          data: { pid: 12345, appName: 'socket' },
        }),
      ).toBe(false)
    })

    it('returns false for missing pid', () => {
      expect(
        isValidIpcHandshake({
          id: 'test',
          timestamp: Date.now(),
          type: 'handshake',
          data: { version: '1.0.0', appName: 'socket' },
        }),
      ).toBe(false)
    })

    it('returns false for invalid pid', () => {
      expect(
        isValidIpcHandshake({
          id: 'test',
          timestamp: Date.now(),
          type: 'handshake',
          data: { version: '1.0.0', pid: 0, appName: 'socket' },
        }),
      ).toBe(false)
    })

    it('returns false for null data', () => {
      expect(
        isValidIpcHandshake({
          id: 'test',
          timestamp: Date.now(),
          type: 'handshake',
          data: null,
        }),
      ).toBe(false)
    })
  })

  describe('isValidIpcHandle', () => {
    it('returns true for valid handle', () => {
      const handle = {
        pid: 12345,
        timestamp: Date.now(),
        data: { status: 'ready' },
      }

      expect(isValidIpcHandle(handle)).toBe(true)
    })

    it('returns false for null', () => {
      expect(isValidIpcHandle(null)).toBe(false)
    })

    it('returns false for non-object', () => {
      expect(isValidIpcHandle('string')).toBe(false)
    })

    it('returns false for invalid pid', () => {
      expect(
        isValidIpcHandle({
          pid: 0,
          timestamp: Date.now(),
          data: {},
        }),
      ).toBe(false)
    })

    it('returns false for invalid timestamp', () => {
      expect(
        isValidIpcHandle({
          pid: 12345,
          timestamp: -1,
          data: {},
        }),
      ).toBe(false)
    })

    it('returns false for missing data', () => {
      expect(
        isValidIpcHandle({
          pid: 12345,
          timestamp: Date.now(),
        }),
      ).toBe(false)
    })
  })

  describe('createIpcMessage', () => {
    it('creates valid message with type and data', () => {
      const message = createIpcMessage('test-type', { foo: 'bar' })

      expect(isValidIpcMessage(message)).toBe(true)
      expect(message.type).toBe('test-type')
      expect(message.data).toEqual({ foo: 'bar' })
    })

    it('generates unique id', () => {
      const msg1 = createIpcMessage('test', {})
      const msg2 = createIpcMessage('test', {})

      expect(msg1.id).not.toBe(msg2.id)
    })

    it('sets current timestamp', () => {
      const before = Date.now()
      const message = createIpcMessage('test', {})
      const after = Date.now()

      expect(message.timestamp).toBeGreaterThanOrEqual(before)
      expect(message.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('createIpcHandshake', () => {
    it('creates valid handshake', () => {
      const handshake = createIpcHandshake({
        version: '1.0.0',
        appName: 'socket-cli',
      })

      expect(isValidIpcHandshake(handshake)).toBe(true)
      expect(handshake.type).toBe('handshake')
      expect(handshake.data.version).toBe('1.0.0')
      expect(handshake.data.appName).toBe('socket-cli')
      expect(handshake.data.pid).toBe(process.pid)
    })

    it('includes optional apiToken', () => {
      const handshake = createIpcHandshake({
        version: '1.0.0',
        appName: 'socket-cli',
        apiToken: 'secret-token',
      })

      expect(handshake.data.apiToken).toBe('secret-token')
    })
  })

  describe('parseIpcMessage', () => {
    it('returns valid message object as-is', () => {
      const message = {
        id: 'test-123',
        timestamp: Date.now(),
        type: 'test',
        data: {},
      }

      expect(parseIpcMessage(message)).toBe(message)
    })

    it('parses valid JSON string', () => {
      const message = {
        id: 'test-123',
        timestamp: Date.now(),
        type: 'test',
        data: { key: 'value' },
      }

      const result = parseIpcMessage(JSON.stringify(message))

      expect(result).toEqual(message)
    })

    it('returns null for invalid object', () => {
      expect(parseIpcMessage({ invalid: true })).toBeNull()
    })

    it('returns null for invalid JSON string', () => {
      expect(parseIpcMessage('not-json')).toBeNull()
    })

    it('returns null for JSON with invalid message', () => {
      expect(parseIpcMessage(JSON.stringify({ invalid: true }))).toBeNull()
    })

    it('returns null for null input', () => {
      expect(parseIpcMessage(null)).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(parseIpcMessage(undefined)).toBeNull()
    })
  })
})
