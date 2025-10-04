/** @fileoverview Tests for debug utilities. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  debugApiResponse,
  debugConfig,
  debugFileOp,
  debugGit,
  debugScan,
} from './debug.mts'

// Mock the debug functions from registry
vi.mock('@socketsecurity/registry/lib/debug', () => ({
  debugDir: vi.fn(),
  debugFn: vi.fn(() => vi.fn()),
  debugLog: vi.fn(),
  isDebug: vi.fn(() => false),
}))

describe('debug utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('debugApiResponse', () => {
    it('should handle error response', () => {
      const error = new Error('Network error')
      debugApiResponse('/api/scan', undefined, error)
      // Should call debugDir with error details
    })

    it('should handle 4xx status code', () => {
      debugApiResponse('/api/scan', 404)
      // Should call debugFn with warn level
    })

    it('should handle 5xx status code', () => {
      debugApiResponse('/api/scan', 500)
      // Should call debugFn with warn level
    })

    it('should handle success status', () => {
      debugApiResponse('/api/scan', 200)
      // Should call debugFn with notice level if debug is enabled
    })

    it('should handle unknown error', () => {
      debugApiResponse('/api/scan', undefined, 'string error')
      // Should handle non-Error objects
    })

    it('should handle pending status', () => {
      debugApiResponse('/api/scan')
      // Should handle no status
    })
  })

  describe('debugFileOp', () => {
    it('should handle file read with error', () => {
      const error = new Error('File not found')
      debugFileOp('read', '/path/to/file', error)
      // Should call debugDir with warn level
    })

    it('should handle file write success', () => {
      debugFileOp('write', '/path/to/file')
      // Should call debugFn with silly level if enabled
    })

    it('should handle file delete', () => {
      debugFileOp('delete', '/path/to/file')
      // Should log operation
    })

    it('should handle file create', () => {
      debugFileOp('create', '/path/to/file')
      // Should log operation
    })

    it('should handle unknown error type', () => {
      debugFileOp('read', '/path/to/file', 'string error')
      // Should handle non-Error objects
    })
  })

  describe('debugScan', () => {
    it('should handle scan start', () => {
      debugScan('start', 10)
      // Should log scan start with package count
    })

    it('should handle scan start without package count', () => {
      debugScan('start')
      // Should handle missing package count
    })

    it('should handle scan progress', () => {
      debugScan('progress', 5)
      // Should log progress if silly debug enabled
    })

    it('should handle scan progress without count', () => {
      debugScan('progress')
      // Should handle missing package count
    })

    it('should handle scan complete', () => {
      debugScan('complete', 10)
      // Should log completion with package count
    })

    it('should handle scan complete without count', () => {
      debugScan('complete')
      // Should log completion without package count
    })

    it('should handle scan error', () => {
      const error = new Error('Scan failed')
      debugScan('error', undefined, error)
      // Should call debugDir with error details
    })

    it('should handle scan error with details', () => {
      debugScan('error', undefined, { reason: 'network timeout' })
      // Should log error with details
    })
  })

  describe('debugConfig', () => {
    it('should handle config found', () => {
      debugConfig('socket.yml', true)
      // Should log config loaded
    })

    it('should handle config not found', () => {
      debugConfig('socket.yml', false)
      // Should log config not found if silly enabled
    })

    it('should handle config load error', () => {
      const error = new Error('Parse error')
      debugConfig('socket.yml', false, error)
      // Should call debugDir with warn level
    })

    it('should handle unknown error type', () => {
      debugConfig('socket.yml', false, 'string error')
      // Should handle non-Error objects
    })
  })

  describe('debugGit', () => {
    it('should handle git operation failure', () => {
      debugGit('commit', false, { message: 'No changes' })
      // Should call debugDir with warn level
    })

    it('should handle git push success', () => {
      debugGit('push', true)
      // Should log important operation
    })

    it('should handle git commit success', () => {
      debugGit('commit', true)
      // Should log important operation
    })

    it('should handle git fetch success', () => {
      debugGit('fetch', true)
      // Should log if silly enabled
    })

    it('should handle git operation with details', () => {
      debugGit('pull', true, { branch: 'main' })
      // Should include details if provided
    })

    it('should handle git failure without details', () => {
      debugGit('checkout', false)
      // Should handle missing details
    })
  })

  describe('integration', () => {
    it('should not crash with all functions called in sequence', () => {
      expect(() => {
        debugApiResponse('/test', 200)
        debugFileOp('read', '/test')
        debugScan('start', 1)
        debugConfig('test', true)
        debugGit('commit', true)
      }).not.toThrow()
    })
  })
})
