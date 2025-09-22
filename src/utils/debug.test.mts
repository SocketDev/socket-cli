import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  debugApiResponse,
  debugConfig,
  debugFileOp,
  debugGit,
  debugScan,
} from './debug.mts'

// Mock the registry debug functions.
vi.mock('@socketsecurity/registry/lib/debug', () => ({
  debugDir: vi.fn(),
  debugFn: vi.fn(),
  isDebug: vi.fn((category) => {
    // Mock different debug levels.
    if (category === 'notice') return true
    if (category === 'silly') return false
    return false
  }),
}))

describe('debug utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('debugApiResponse', () => {
    it('logs error when error is provided', async () => {
      const { debugDir } = await import('@socketsecurity/registry/lib/debug')
      const error = new Error('API failed')

      debugApiResponse('/api/test', undefined, error)

      expect(debugDir).toHaveBeenCalledWith('error', {
        endpoint: '/api/test',
        error: 'API failed',
      })
    })

    it('logs warning for HTTP error status codes', async () => {
      const { debugFn } = await import('@socketsecurity/registry/lib/debug')

      debugApiResponse('/api/test', 404)

      expect(debugFn).toHaveBeenCalledWith('warn', 'API /api/test: HTTP 404')
    })

    it('logs notice for successful responses when debug is enabled', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockReturnValue(true)

      debugApiResponse('/api/test', 200)

      expect(debugFn).toHaveBeenCalledWith('notice', 'API /api/test: 200')
    })

    it('does not log for successful responses when debug is disabled', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockReturnValue(false)

      debugApiResponse('/api/test', 200)

      expect(debugFn).not.toHaveBeenCalled()
    })

    it('handles non-Error objects in error parameter', async () => {
      const { debugDir } = await import('@socketsecurity/registry/lib/debug')

      debugApiResponse('/api/test', undefined, 'String error')

      expect(debugDir).toHaveBeenCalledWith('error', {
        endpoint: '/api/test',
        error: 'Unknown error',
      })
    })
  })

  describe('debugFileOp', () => {
    it('logs warning when error occurs', async () => {
      const { debugDir } = await import('@socketsecurity/registry/lib/debug')
      const error = new Error('File not found')

      debugFileOp('read', '/path/to/file', error)

      expect(debugDir).toHaveBeenCalledWith('warn', {
        operation: 'read',
        filepath: '/path/to/file',
        error: 'File not found',
      })
    })

    it('logs silly level for successful operations when enabled', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockReturnValue(true)

      debugFileOp('write', '/path/to/file')

      expect(debugFn).toHaveBeenCalledWith('silly', 'File write: /path/to/file')
    })

    it('does not log for successful operations when silly is disabled', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockReturnValue(false)

      debugFileOp('create', '/path/to/file')

      expect(debugFn).not.toHaveBeenCalled()
    })

    it('handles all operation types', () => {
      const operations: Array<'read' | 'write' | 'delete' | 'create'> = [
        'read',
        'write',
        'delete',
        'create',
      ]

      operations.forEach(op => {
        debugFileOp(op, `/path/${op}`)
        // No errors expected.
      })
    })
  })

  describe('debugScan', () => {
    it('logs start phase with package count', async () => {
      const { debugFn } = await import('@socketsecurity/registry/lib/debug')

      debugScan('start', 42)

      expect(debugFn).toHaveBeenCalledWith('notice', 'Scanning 42 packages')
    })

    it('does not log start phase without package count', async () => {
      const { debugFn } = await import('@socketsecurity/registry/lib/debug')

      debugScan('start')

      expect(debugFn).not.toHaveBeenCalled()
    })

    it('logs progress when silly debug is enabled', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockReturnValue(true)

      debugScan('progress', 10)

      expect(debugFn).toHaveBeenCalledWith('silly', 'Scan progress: 10 packages processed')
    })

    it('logs complete phase', async () => {
      const { debugFn } = await import('@socketsecurity/registry/lib/debug')

      debugScan('complete', 50)

      expect(debugFn).toHaveBeenCalledWith('notice', 'Scan complete: 50 packages')
    })

    it('logs complete phase without package count', async () => {
      const { debugFn } = await import('@socketsecurity/registry/lib/debug')

      debugScan('complete')

      expect(debugFn).toHaveBeenCalledWith('notice', 'Scan complete')
    })

    it('logs error phase with details', async () => {
      const { debugDir } = await import('@socketsecurity/registry/lib/debug')
      const errorDetails = { message: 'Scan failed' }

      debugScan('error', undefined, errorDetails)

      expect(debugDir).toHaveBeenCalledWith('error', {
        phase: 'scan_error',
        details: errorDetails,
      })
    })
  })

  describe('debugConfig', () => {
    it('logs error when provided', async () => {
      const { debugDir } = await import('@socketsecurity/registry/lib/debug')
      const error = new Error('Config invalid')

      debugConfig('.socketrc', false, error)

      expect(debugDir).toHaveBeenCalledWith('warn', {
        source: '.socketrc',
        error: 'Config invalid',
      })
    })

    it('logs notice when config is found', async () => {
      const { debugFn } = await import('@socketsecurity/registry/lib/debug')

      debugConfig('.socketrc', true)

      expect(debugFn).toHaveBeenCalledWith('notice', 'Config loaded: .socketrc')
    })

    it('logs silly when config not found and debug enabled', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockReturnValue(true)

      debugConfig('.socketrc', false)

      expect(debugFn).toHaveBeenCalledWith('silly', 'Config not found: .socketrc')
    })

    it('does not log when config not found and debug disabled', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockReturnValue(false)

      debugConfig('.socketrc', false)

      expect(debugFn).not.toHaveBeenCalled()
    })
  })

  describe('debugGit', () => {
    it('logs warning for failed operations', async () => {
      const { debugDir } = await import('@socketsecurity/registry/lib/debug')

      debugGit('push', false, { branch: 'main' })

      expect(debugDir).toHaveBeenCalledWith('warn', {
        git_op: 'push',
        branch: 'main',
      })
    })

    it('logs notice for important successful operations', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockReturnValue(true)

      debugGit('push', true)

      expect(debugFn).toHaveBeenCalledWith('notice', 'Git push succeeded')
    })

    it('logs commit operations', async () => {
      const { debugFn } = await import('@socketsecurity/registry/lib/debug')

      debugGit('commit', true)

      expect(debugFn).toHaveBeenCalledWith('notice', 'Git commit succeeded')
    })

    it('logs other operations only with silly debug', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockImplementation((level) => level === 'silly')

      debugGit('status', true)

      expect(debugFn).toHaveBeenCalledWith('silly', 'Git status')
    })

    it('does not log non-important operations without silly debug', async () => {
      const { debugFn, isDebug } = await import('@socketsecurity/registry/lib/debug')
      vi.mocked(isDebug).mockReturnValue(false)

      debugGit('status', true)

      expect(debugFn).not.toHaveBeenCalled()
    })
  })
})