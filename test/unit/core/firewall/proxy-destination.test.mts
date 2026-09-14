import { describe, expect, it } from 'vitest'

import { createFirewallPolicy } from '../../../../src/core/firewall/policy/index.mts'
import {
  pinFirewallDestination,
  resolveFirewallDestinationAddress,
} from '../../../../src/core/firewall/proxy.mts'

describe('firewall destination resolution', () => {
  it('rejects private DNS answers and selects a public answer', async () => {
    const target = new URL('https://packages.example/artifact.tgz')
    await expect(
      resolveFirewallDestinationAddress(target, {
        lookupDestination: async () => [
          { address: '127.0.0.1', family: 4 },
          { address: '169.254.169.254', family: 4 },
        ],
      }),
    ).rejects.toThrow(/only private, loopback, or link-local addresses/)
    await expect(
      resolveFirewallDestinationAddress(target, {
        lookupDestination: async () => [
          { address: '127.0.0.1', family: 4 },
          { address: '8.8.8.8', family: 4 },
        ],
      }),
    ).resolves.toEqual({ address: '8.8.8.8', family: 4 })
  })

  it('pins the validated address while preserving the request path', () => {
    const target = new URL('https://packages.example:8443/artifact.tgz?q=1')
    expect(
      pinFirewallDestination(target, {
        address: '2001:db8::10',
        family: 6,
      }).href,
    ).toBe('https://[2001:db8::10]:8443/artifact.tgz?q=1')
    expect(target.hostname).toBe('packages.example')
  })

  it('allows private addresses only for configured registry routes', () => {
    const policy = createFirewallPolicy({
      customRegistries: ['npm:registry.internal.example'],
    })
    expect(
      policy.allowPrivateDestination(
        new URL('https://registry.internal.example/example'),
      ),
    ).toBe(true)
    expect(
      policy.allowPrivateDestination(
        new URL('https://unknown.internal/example'),
      ),
    ).toBe(false)
    expect(
      policy.allowPrivateDestination(
        new URL('https://registry.npmjs.org/example'),
      ),
    ).toBe(false)
    policy.close()
  })
})
