import { Module } from 'node:module'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock process methods
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  // Mock implementation that doesn't actually exit.
}) as any)
const mockProcessKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

// Mock shadowNpmBin
const mockShadowNpmBin = vi.fn()

// Mock Module._load to intercept CommonJS require calls
const originalLoad = Module._load
Module._load = vi.fn((request: string, parent: any, isMain?: boolean) => {
  if (request === '../dist/shadow-npm-bin.js') {
    return mockShadowNpmBin
  }
  return originalLoad.call(Module, request, parent, isMain)
})

describe('npm-cli', () => {
  const mockChildProcess = {
    on: vi.fn(),
    pid: 12345,
  }

  const mockSpawnResult = {
    spawnPromise: {
      process: mockChildProcess,
      then: vi.fn().mockResolvedValue({ success: true, code: 0 }),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset process properties.
    process.exitCode = undefined

    // Setup default mock implementations.
    mockShadowNpmBin.mockResolvedValue(mockSpawnResult)
    mockChildProcess.on.mockImplementation(() => {
      // No-op by default.
    })

    // Clear module cache to ensure fresh imports.
    vi.resetModules()
  })

  it('should set initial exit code to 1', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs', 'install']

    try {
      await import('./npm-cli.mts')
      expect(process.exitCode).toBe(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should call shadowNpmBin with correct arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs', 'install', 'lodash']

    try {
      await import('./npm-cli.mts')

      expect(mockShadowNpmBin).toHaveBeenCalledWith(['install', 'lodash'], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: { ...process.env },
      })
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with numeric code', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs', 'install']

    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        // Trigger callback immediately.
        callback(1, null)
      }
    })

    try {
      await import('./npm-cli.mts')

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with signal', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs', 'test']

    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        // Trigger callback immediately.
        callback(null, 'SIGTERM')
      }
    })

    try {
      await import('./npm-cli.mts')

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty arguments array', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs']

    try {
      await import('./npm-cli.mts')

      expect(mockShadowNpmBin).toHaveBeenCalledWith([], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: { ...process.env },
      })
    } finally {
      process.argv = originalArgv
    }
  })

  it('should preserve environment variables in spawn options', async () => {
    const originalArgv = process.argv
    const originalEnv = process.env
    process.argv = ['node', 'npm-cli.mjs', 'run', 'build']
    process.env = { ...originalEnv, CUSTOM_VAR: 'test-value' }

    try {
      await import('./npm-cli.mts')

      expect(mockShadowNpmBin).toHaveBeenCalledWith(['run', 'build'], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: expect.objectContaining({ CUSTOM_VAR: 'test-value' }),
      })
    } finally {
      process.argv = originalArgv
      process.env = originalEnv
    }
  })

  it('should wait for spawn promise completion', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs', 'version']

    const mockThen = vi.fn().mockResolvedValue({ success: true })
    mockShadowNpmBin.mockResolvedValue({
      spawnPromise: {
        process: mockChildProcess,
        then: mockThen,
      },
    })

    try {
      await import('./npm-cli.mts')

      // The spawn promise should be awaited.
      expect(mockThen).toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
    }
  })
})
