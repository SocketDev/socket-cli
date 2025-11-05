/**
 * Unit tests for cmd-repository-list-simplified.
 *
 * Purpose:
 * Tests the repository list command structure and basic functionality. Validates
 * that the command exports the required interface and can be loaded in isolated mode.
 *
 * Test Coverage:
 * - Command default export existence
 * - Required command structure (run, description)
 * - Command function type validation
 *
 * Testing Approach:
 * Uses dynamic imports with SDK mocking to avoid dynamic require errors in isolated
 * mode. Validates command interface contract.
 *
 * Related Files:
 * - src/commands/repository/cmd-repository-list-simplified.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  // Mock SDK to avoid dynamic require errors in isolated mode.
  vi.doMock('@socketsecurity/sdk', () => ({
    SocketSdk: class MockSocketSdk {},
    createUserAgentFromPkgJson: vi.fn(),
  }))
})

describe('cmd-repository-list', () => {
  it('should have a default export', async () => {
    const module = await import(
      '../../../../src/commands/repository/cmd-repository-list-simplified.mts'
    )
    expect(module.default).toBeDefined()
    expect(typeof module.default).toBe('object')
  })

  it('should have required command structure', async () => {
    const module = await import(
      '../../../../src/commands/repository/cmd-repository-list-simplified.mts'
    )
    const cmd = module.default
    expect(cmd.run).toBeDefined()
    expect(cmd.description).toBeDefined()
    expect(typeof cmd.run).toBe('function')
  })
})
