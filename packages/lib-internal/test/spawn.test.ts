/**
 * @fileoverview Unit tests for process spawn utilities.
 *
 * Tests child process spawning utilities:
 * - spawn() async process execution with options
 * - spawnSync() synchronous process execution
 * - isSpawnError() type guard for spawn errors
 * - isStdioType() validates stdio option values
 * - Error handling, exit codes, and output capture
 * Used by Socket tools for git operations, npm commands, and external process execution.
 */

import {
  isSpawnError,
  isStdioType,
  spawn,
  spawnSync,
} from '@socketsecurity/lib/spawn'
import { describe, expect, it } from 'vitest'

describe('spawn', () => {
  describe('isSpawnError', () => {
    it('should return true for error with code property', () => {
      const error = { code: 1 }
      expect(isSpawnError(error)).toBe(true)
    })

    it('should return true for error with errno property', () => {
      const error = { errno: -2 }
      expect(isSpawnError(error)).toBe(true)
    })

    it('should return true for error with syscall property', () => {
      const error = { syscall: 'spawn' }
      expect(isSpawnError(error)).toBe(true)
    })

    it('should return false for null', () => {
      expect(isSpawnError(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isSpawnError(undefined)).toBe(false)
    })

    it('should return false for non-object', () => {
      expect(isSpawnError('string')).toBe(false)
      expect(isSpawnError(123)).toBe(false)
      expect(isSpawnError(true)).toBe(false)
    })

    it('should return false for object without spawn error properties', () => {
      expect(isSpawnError({})).toBe(false)
      expect(isSpawnError({ message: 'error' })).toBe(false)
    })

    it('should handle error with undefined code', () => {
      const error = { code: undefined, errno: 1 }
      expect(isSpawnError(error)).toBe(true)
    })
  })

  describe('isStdioType', () => {
    describe('single argument mode (validation)', () => {
      it('should return true for valid stdio types', () => {
        expect(isStdioType('pipe')).toBe(true)
        expect(isStdioType('ignore')).toBe(true)
        expect(isStdioType('inherit')).toBe(true)
        expect(isStdioType('overlapped')).toBe(true)
      })

      it('should return false for invalid types', () => {
        expect(isStdioType('invalid')).toBe(false)
        expect(isStdioType('ipc')).toBe(false) // 'ipc' is valid for spawn but not a base IOType
        expect(isStdioType('')).toBe(false)
      })

      it('should return false for arrays', () => {
        expect(isStdioType(['pipe'])).toBe(false)
      })
    })

    describe('two argument mode (matching)', () => {
      it('should match exact string types', () => {
        expect(isStdioType('pipe', 'pipe')).toBe(true)
        expect(isStdioType('ignore', 'ignore')).toBe(true)
        expect(isStdioType('inherit', 'inherit')).toBe(true)
      })

      it('should not match different types', () => {
        expect(isStdioType('pipe', 'ignore')).toBe(false)
        expect(isStdioType('ignore', 'pipe')).toBe(false)
      })

      it('should treat null/undefined as pipe', () => {
        expect(isStdioType(null as any, 'pipe')).toBe(true)
        expect(isStdioType(undefined as any, 'pipe')).toBe(true)
        expect(isStdioType(null as any, 'ignore')).toBe(false)
      })

      it('should match array with all elements same as type', () => {
        expect(isStdioType(['pipe', 'pipe', 'pipe'], 'pipe')).toBe(true)
        expect(isStdioType(['ignore', 'ignore', 'ignore'], 'ignore')).toBe(true)
      })

      it('should not match array with different elements', () => {
        expect(isStdioType(['pipe', 'ignore', 'pipe'], 'pipe')).toBe(false)
        expect(isStdioType(['pipe', 'pipe', 'ignore'], 'pipe')).toBe(false)
      })

      it('should not match array with less than 3 elements', () => {
        expect(isStdioType(['pipe', 'pipe'], 'pipe')).toBe(false)
        expect(isStdioType(['pipe'], 'pipe')).toBe(false)
      })

      it('should match array with more than 3 elements if first 3 match', () => {
        expect(isStdioType(['pipe', 'pipe', 'pipe', 'inherit'], 'pipe')).toBe(
          true,
        )
      })
    })
  })

  describe('spawn', () => {
    it('should spawn a simple command successfully', async () => {
      const result = await spawn('echo', ['hello'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('hello')
    })

    it('should spawn command without args', async () => {
      const result = await spawn('pwd')
      expect(result.code).toBe(0)
      expect(typeof result.stdout).toBe('string')
    })

    it('should capture stdout', async () => {
      const result = await spawn('echo', ['test output'])
      expect(result.stdout).toContain('test output')
    })

    it('should return command and args in result', async () => {
      const result = await spawn('echo', ['hello'])
      expect(result.cmd).toBe('echo')
      expect(result.args).toEqual(['hello'])
    })

    it('should handle commands with multiple args', async () => {
      const result = await spawn('echo', ['arg1', 'arg2', 'arg3'])
      expect(result.code).toBe(0)
    })

    it('should handle empty args array', async () => {
      const result = await spawn('pwd', [])
      expect(result.code).toBe(0)
    })

    it('should handle options with cwd', async () => {
      const result = await spawn('pwd', [], {
        cwd: process.cwd(),
      })
      expect(result.code).toBe(0)
    })

    it('should handle options with env', async () => {
      const result = await spawn('echo', ['$TEST_VAR'], {
        env: { TEST_VAR: 'test-value' },
        shell: true,
      })
      expect(result.code).toBe(0)
    })

    it('should handle stdio: pipe (default)', async () => {
      const result = await spawn('echo', ['hello'], {
        stdio: 'pipe',
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toBeTruthy()
    })

    it('should handle stdio: inherit', async () => {
      const result = await spawn('echo', ['hello'], {
        stdio: 'inherit',
      })
      expect(result.code).toBe(0)
    })

    it('should handle stdio as array', async () => {
      const result = await spawn('echo', ['hello'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      expect(result.code).toBe(0)
    })

    it('should handle stdioString: true (default)', async () => {
      const result = await spawn('echo', ['hello'], {
        stdioString: true,
      })
      expect(typeof result.stdout).toBe('string')
      expect(typeof result.stderr).toBe('string')
    })

    it('should handle stdioString: false', async () => {
      const result = await spawn('echo', ['hello'], {
        stdioString: false,
      })
      expect(Buffer.isBuffer(result.stdout)).toBe(true)
      expect(Buffer.isBuffer(result.stderr)).toBe(true)
    })

    it('should strip ANSI codes by default', async () => {
      // Test with a command that outputs ANSI codes
      const result = await spawn('echo', ['-e', '\x1b[31mred\x1b[0m'], {
        shell: true,
      })
      expect(result.code).toBe(0)
      // ANSI codes should be stripped
      expect(result.stdout).not.toContain('\x1b[31m')
    })

    it('should not strip ANSI codes when stripAnsi: false', async () => {
      const result = await spawn('echo', ['-e', '\x1b[31mred\x1b[0m'], {
        shell: true,
        stripAnsi: false,
      })
      expect(result.code).toBe(0)
    })

    it('should handle readonly args array', async () => {
      const args = ['hello'] as const
      const result = await spawn('echo', args)
      expect(result.code).toBe(0)
    })

    it('should throw error for non-zero exit code', async () => {
      try {
        await spawn('sh', ['-c', 'exit 1'])
        expect.fail('Should have thrown')
      } catch (error) {
        expect(isSpawnError(error)).toBe(true)
      }
    })

    it('should include stderr in error', async () => {
      try {
        await spawn('sh', ['-c', 'echo error >&2; exit 1'])
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.stderr).toBeTruthy()
      }
    })

    it('should have process property on result', () => {
      const result = spawn('echo', ['hello'])
      expect(result.process).toBeTruthy()
      expect(typeof result.process.kill).toBe('function')
    })

    it('should have stdin property on result', async () => {
      const result = spawn('cat', [])
      expect(result.stdin).toBeTruthy()
      result.process.kill()
      // Wait for process to be killed
      try {
        await result
      } catch {
        // Expected to fail since we killed it
      }
    })

    it('should handle Windows script extensions on Windows', async () => {
      if (process.platform === 'win32') {
        // On Windows, commands with .cmd/.bat extensions should be handled
        const result = await spawn('npm.cmd', ['--version'], {
          shell: true,
        })
        expect(result.code).toBe(0)
      } else {
        expect(true).toBe(true) // Skip on non-Windows
      }
    })

    it('should handle shell option', async () => {
      const result = await spawn('echo', ['$HOME'], {
        shell: true,
      })
      expect(result.code).toBe(0)
    })

    it.skipIf(process.platform === 'win32')(
      'should handle shell as string path',
      async () => {
        const result = await spawn('echo', ['hello'], {
          shell: '/bin/sh',
        })
        expect(result.code).toBe(0)
      },
    )

    it('should handle undefined args', async () => {
      const result = await spawn('pwd', undefined)
      expect(result.code).toBe(0)
    })

    it('should handle undefined options', async () => {
      const result = await spawn('echo', ['hello'], undefined)
      expect(result.code).toBe(0)
    })

    it('should handle empty options object', async () => {
      const result = await spawn('echo', ['hello'], {})
      expect(result.code).toBe(0)
    })
  })

  describe('spawnSync', () => {
    it('should spawn a simple command synchronously', () => {
      const result = spawnSync('echo', ['hello'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('hello')
    })

    it('should spawn command without args', () => {
      const result = spawnSync('pwd')
      expect(result.status).toBe(0)
      expect(typeof result.stdout).toBe('string')
    })

    it('should capture stdout', () => {
      const result = spawnSync('echo', ['test output'])
      expect(result.stdout).toContain('test output')
    })

    it('should handle commands with multiple args', () => {
      const result = spawnSync('echo', ['arg1', 'arg2', 'arg3'])
      expect(result.status).toBe(0)
    })

    it('should handle empty args array', () => {
      const result = spawnSync('pwd', [])
      expect(result.status).toBe(0)
    })

    it('should handle options with cwd', () => {
      const result = spawnSync('pwd', [], {
        cwd: process.cwd(),
      })
      expect(result.status).toBe(0)
    })

    it('should handle options with env', () => {
      const result = spawnSync('echo', ['$TEST_VAR'], {
        env: { TEST_VAR: 'test-value' },
        shell: true,
      })
      expect(result.status).toBe(0)
    })

    it('should handle stdioString: true (default)', () => {
      const result = spawnSync('echo', ['hello'], {
        stdioString: true,
      })
      expect(typeof result.stdout).toBe('string')
      expect(typeof result.stderr).toBe('string')
    })

    it('should handle stdioString: false', () => {
      const result = spawnSync('echo', ['hello'], {
        stdioString: false,
      })
      expect(Buffer.isBuffer(result.stdout)).toBe(true)
      expect(Buffer.isBuffer(result.stderr)).toBe(true)
    })

    it('should strip ANSI codes by default', () => {
      const result = spawnSync('echo', ['-e', '\x1b[31mred\x1b[0m'], {
        shell: true,
      })
      expect(result.status).toBe(0)
    })

    it('should not strip ANSI codes when stripAnsi: false', () => {
      const result = spawnSync('echo', ['-e', '\x1b[31mred\x1b[0m'], {
        shell: true,
        stripAnsi: false,
      })
      expect(result.status).toBe(0)
    })

    it('should handle readonly args array', () => {
      const args = ['hello'] as const
      const result = spawnSync('echo', args)
      expect(result.status).toBe(0)
    })

    it('should return non-zero status for failed command', () => {
      const result = spawnSync('sh', ['-c', 'exit 1'])
      expect(result.status).toBe(1)
    })

    it('should capture stderr', () => {
      const result = spawnSync('sh', ['-c', 'echo error >&2'])
      expect(result.stderr).toContain('error')
    })

    it('should have output array', () => {
      const result = spawnSync('echo', ['hello'])
      expect(Array.isArray(result.output)).toBe(true)
    })

    it('should handle Windows script extensions on Windows', () => {
      if (process.platform === 'win32') {
        const result = spawnSync('npm.cmd', ['--version'], {
          shell: true,
        })
        expect(result.status).toBe(0)
      } else {
        expect(true).toBe(true) // Skip on non-Windows
      }
    })

    it('should handle shell option', () => {
      const result = spawnSync('echo', ['$HOME'], {
        shell: true,
      })
      expect(result.status).toBe(0)
    })

    it.skipIf(process.platform === 'win32')(
      'should handle shell as string path',
      () => {
        const result = spawnSync('echo', ['hello'], {
          shell: '/bin/sh',
        })
        expect(result.status).toBe(0)
      },
    )

    it('should handle undefined args', () => {
      const result = spawnSync('pwd', undefined)
      expect(result.status).toBe(0)
    })

    it('should handle undefined options', () => {
      const result = spawnSync('echo', ['hello'], undefined)
      expect(result.status).toBe(0)
    })

    it('should handle empty options object', () => {
      const result = spawnSync('echo', ['hello'], {})
      expect(result.status).toBe(0)
    })

    it('should have signal property', () => {
      const result = spawnSync('echo', ['hello'])
      expect('signal' in result).toBe(true)
    })

    it('should have pid property', () => {
      const result = spawnSync('echo', ['hello'])
      expect(typeof result.pid).toBe('number')
      expect(result.pid).toBeGreaterThan(0)
    })
  })

  describe('error cases', () => {
    it('should handle non-existent command (spawn)', async () => {
      try {
        await spawn('nonexistent-command-12345')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(isSpawnError(error)).toBe(true)
      }
    })

    it('should handle non-existent command (spawnSync)', () => {
      const result = spawnSync('nonexistent-command-12345')
      expect(result.error).toBeTruthy()
    })

    it('should handle command with invalid args', async () => {
      try {
        await spawn('ls', ['--invalid-flag-that-does-not-exist-xyz'])
        expect.fail('Should have thrown')
      } catch (error) {
        expect(isSpawnError(error)).toBe(true)
      }
    })
  })

  describe('cross-platform behavior', () => {
    it('should work on current platform', () => {
      const result = spawnSync('echo', ['hello'])
      expect(result.status).toBe(0)
    })

    it('should handle platform-specific line endings', () => {
      const result = spawnSync('echo', ['hello'])
      expect(result.stdout).toBeTruthy()
    })
  })

  describe('security', () => {
    it('should safely handle user input in args array', async () => {
      const userInput = '; rm -rf /'
      const result = await spawn('echo', [userInput])
      expect(result.stdout).toContain(';')
      expect(result.stdout).toContain('rm')
    })

    it('should safely handle special characters', async () => {
      const result = await spawn('echo', ['$PATH', '&&', 'echo', 'test'])
      expect(result.code).toBe(0)
    })
  })
})
