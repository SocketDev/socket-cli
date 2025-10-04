import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock spawn from registry.
const mockSpawn = vi.fn()
vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: mockSpawn,
}))

describe('yarn-cli', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.resetModules()
  })

  it('should forward to sfw with yarn', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs', 'install']

    mockSpawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    try {
      await import('./yarn-cli.mts')

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['sfw', 'yarn', 'install'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    } finally {
      process.argv = originalArgv
    }
  })

  it('should forward all arguments to sfw', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs', 'add', 'react', 'react-dom']

    mockSpawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    try {
      await import('./yarn-cli.mts')

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['sfw', 'yarn', 'add', 'react', 'react-dom'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    } finally {
      process.argv = originalArgv
    }
  })

  it('should set exit code on error', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs', 'build']

    mockSpawn.mockResolvedValue({ code: 1, stdout: '', stderr: 'Build failed' })

    try {
      await import('./yarn-cli.mts')

      expect(process.exitCode).toBe(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs']

    mockSpawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    try {
      await import('./yarn-cli.mts')

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        ['sfw', 'yarn'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle arguments with spaces', async () => {
    const originalArgv = process.argv
    process.argv = [
      'node',
      'yarn-cli.mjs',
      'add',
      'package-name',
      '--message',
      'commit message with spaces',
    ]

    mockSpawn.mockResolvedValue({ code: 0, stdout: '', stderr: '' })

    try {
      await import('./yarn-cli.mts')

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        [
          'sfw',
          'yarn',
          'add',
          'package-name',
          '--message',
          'commit message with spaces',
        ],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    } finally {
      process.argv = originalArgv
    }
  })
})
