/** @fileoverview Tests for repository list command */

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
    const module = await import('./cmd-repository-list-simplified.mts')
    expect(module.default).toBeDefined()
    expect(typeof module.default).toBe('object')
  })

  it('should have required command structure', async () => {
    const module = await import('./cmd-repository-list-simplified.mts')
    const cmd = module.default
    expect(cmd.run).toBeDefined()
    expect(cmd.description).toBeDefined()
    expect(typeof cmd.run).toBe('function')
  })
})
