/** @fileoverview Tests for repository list command */

import { describe, expect, it } from 'vitest'

describe('cmd-repository-list', () => {
  it('should have a default export', async () => {
    const module = await import('./cmd-repository-list-simplified.mts')
    expect(module.default).toBeDefined()
    expect(typeof module.default).toBe('object')
  })

  it('should have required command structure', async () => {
    const module = await import('./cmd-repository-list-simplified.mts')
    const cmd = module.default
    expect(cmd.builder).toBeDefined()
    expect(cmd.description).toBeDefined()
    expect(cmd.handler).toBeDefined()
  })
})
