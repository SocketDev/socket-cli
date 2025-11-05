/** @fileoverview Tests for User-Agent string generation utilities. */
import { describe, expect, it } from 'vitest'

import { createUserAgentFromPkgJson } from '../src/user-agent'

describe('createUserAgentFromPkgJson', () => {
  it('should generate User-Agent without homepage', () => {
    const result = createUserAgentFromPkgJson({
      name: '@socketsecurity/sdk',
      version: '1.0.0',
    })
    expect(result).toBe('socketsecurity-sdk/1.0.0')
  })

  it('should generate User-Agent with homepage', () => {
    const result = createUserAgentFromPkgJson({
      name: '@socketsecurity/sdk',
      version: '1.0.0',
      homepage: 'https://socket.dev',
    })
    expect(result).toBe('socketsecurity-sdk/1.0.0 (https://socket.dev)')
  })

  it('should handle package names without scope', () => {
    const result = createUserAgentFromPkgJson({
      name: 'my-package',
      version: '2.5.3',
      homepage: 'https://example.com',
    })
    expect(result).toBe('my-package/2.5.3 (https://example.com)')
  })

  it('should replace @ and / in scoped package names', () => {
    const result = createUserAgentFromPkgJson({
      name: '@org/my-package',
      version: '1.2.3',
    })
    expect(result).toBe('org-my-package/1.2.3')
  })
})
