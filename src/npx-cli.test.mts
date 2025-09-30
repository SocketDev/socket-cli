import { Module } from 'node:module'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock process methods.
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  // Mock implementation that doesn't actually exit.
}) as any)
const mockProcessKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

// Mock shadowNpxBin.
const mockShadowNpxBin = vi.fn()

// Mock Module._load to intercept CommonJS require calls
const originalLoad = Module._load
Module._load = vi.fn((request: string, parent: any, isMain?: boolean) => {
  if (request === '../dist/shadow-npx-bin.js') {
    return mockShadowNpxBin
  }
  return originalLoad.call(Module, request, parent, isMain)
})

describe('npx-cli', () => {
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
    mockShadowNpxBin.mockResolvedValue(mockSpawnResult)
    mockChildProcess.on.mockImplementation(() => {
      // No-op by default.
    })

    // Clear module cache to ensure fresh imports.
    vi.resetModules()
  })

  it('should set initial exit code to 1', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mjs', 'create-react-app', 'my-app']

    try {
      await import('./npx-cli.mts')
      expect(process.exitCode).toBe(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should call shadowNpxBin with correct arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mjs', 'create-next-app@latest', 'my-app']

    try {
      await import('./npx-cli.mts')

      expect(mockShadowNpxBin).toHaveBeenCalledWith(
        ['create-next-app@latest', 'my-app'],
        {
          stdio: 'inherit',
        },
      )
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with numeric code', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mjs', 'eslint', '.']

    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        // Trigger callback immediately.
        callback(1, null)
      }
    })

    try {
      await import('./npx-cli.mts')

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with signal', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mjs', 'webpack-dev-server']

    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        // Trigger callback immediately.
        callback(null, 'SIGINT')
      }
    })

    try {
      await import('./npx-cli.mts')

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGINT')
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty arguments array', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mjs']

    try {
      await import('./npx-cli.mts')

      expect(mockShadowNpxBin).toHaveBeenCalledWith([], {
        stdio: 'inherit',
      })
    } finally {
      process.argv = originalArgv
    }
  })

  it('should use stdio inherit for process communication', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mjs', 'typescript', '--version']

    try {
      await import('./npx-cli.mts')

      expect(mockShadowNpxBin).toHaveBeenCalledWith(
        ['typescript', '--version'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    } finally {
      process.argv = originalArgv
    }
  })

  it('should wait for spawn promise completion', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mjs', 'jest', '--version']

    const mockThen = vi.fn().mockResolvedValue({ success: true })
    mockShadowNpxBin.mockResolvedValue({
      spawnPromise: {
        process: mockChildProcess,
        then: mockThen,
      },
    })

    try {
      await import('./npx-cli.mts')

      // The spawn promise should be awaited.
      expect(mockThen).toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
    }
  })
})
