/**
 * Unit tests for json command.
 *
 * Tests the command that displays the socket.json configuration that would be
 * applied for a target folder.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
const mockHandleCmdJson = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/json/handle-cmd-json.mts', () => ({
  handleCmdJson: mockHandleCmdJson,
}))

// Mock process.cwd to control the current working directory.
const mockCwd = vi.hoisted(() => vi.fn())
vi.stubGlobal('process', {
  ...process,
  cwd: mockCwd,
})

// Import after mocks.
const { cmdJson } = await import('../../../../src/commands/json/cmd-json.mts')

describe('cmd-json', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCwd.mockReturnValue('/Users/test/project')
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdJson.description).toBe(
        'Display the `socket.json` that would be applied for target folder',
      )
    })

    it('should be hidden', () => {
      expect(cmdJson.hidden).toBe(true)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-json.mts' }
    const context = { parentName: 'socket' }

    it('should call handleCmdJson with current directory when no CWD provided', async () => {
      await cmdJson.run([], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith('/Users/test/project')
    })

    it('should call handleCmdJson with relative path resolved against cwd', async () => {
      await cmdJson.run(['./subdir'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith(
        '/Users/test/project/subdir',
      )
    })

    it('should call handleCmdJson with relative parent path', async () => {
      await cmdJson.run(['../other'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith('/Users/test/other')
    })

    it('should call handleCmdJson with absolute path unchanged', async () => {
      await cmdJson.run(['/absolute/path/to/project'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith('/absolute/path/to/project')
    })

    it('should handle dot as current directory', async () => {
      await cmdJson.run(['.'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith('/Users/test/project')
    })

    it('should handle nested relative paths', async () => {
      await cmdJson.run(['./foo/bar/baz'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith(
        '/Users/test/project/foo/bar/baz',
      )
    })

    it('should handle paths with trailing slash', async () => {
      await cmdJson.run(['./subdir/'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith(
        '/Users/test/project/subdir',
      )
    })

    it('should handle readonly argv array', async () => {
      const readonlyArgv: readonly string[] = ['./target']
      await cmdJson.run(readonlyArgv, importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith(
        '/Users/test/project/target',
      )
    })

    it('should only use first argument as CWD', async () => {
      await cmdJson.run(['./dir1', './dir2', './dir3'], importMeta, context)

      // Should only use first argument.
      expect(mockHandleCmdJson).toHaveBeenCalledWith('/Users/test/project/dir1')
      expect(mockHandleCmdJson).toHaveBeenCalledTimes(1)
    })

    it('should resolve complex relative paths correctly', async () => {
      await cmdJson.run(['./foo/../bar'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith('/Users/test/project/bar')
    })

    it('should handle absolute paths on different root', async () => {
      await cmdJson.run(['/var/www/app'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith('/var/www/app')
    })

    it('should not modify absolute paths with process.cwd', async () => {
      mockCwd.mockReturnValue('/different/cwd')

      await cmdJson.run(['/absolute/path'], importMeta, context)

      // Absolute path should not be affected by cwd.
      expect(mockHandleCmdJson).toHaveBeenCalledWith('/absolute/path')
    })

    it('should handle paths with special characters', async () => {
      await cmdJson.run(['./my-project'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith(
        '/Users/test/project/my-project',
      )
    })

    it('should handle paths with spaces correctly', async () => {
      await cmdJson.run(['./my project'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith(
        '/Users/test/project/my project',
      )
    })

    it('should call handleCmdJson exactly once', async () => {
      await cmdJson.run(['./target'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledTimes(1)
    })

    it('should handle empty string as CWD', async () => {
      await cmdJson.run([''], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith('/Users/test/project')
    })

    it('should resolve multiple parent directory references', async () => {
      mockCwd.mockReturnValue('/Users/test/deep/nested/path')

      await cmdJson.run(['../../..'], importMeta, context)

      expect(mockHandleCmdJson).toHaveBeenCalledWith('/Users/test')
    })
  })
})
