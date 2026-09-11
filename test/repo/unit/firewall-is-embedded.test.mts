import { describe, expect, it } from 'vitest'

import { checkFirewallBundle } from '../../../scripts/repo/check/firewall-is-embedded.mts'

describe('embedded firewall bundle gate', () => {
  it('rejects an external SFW binary', () => {
    expect(
      checkFirewallBundle({ tools: { sfw: { version: '1.0.0' } } }),
    ).toHaveLength(1)
  })
  it('keeps other external tools available', () => {
    expect(
      checkFirewallBundle({ tools: { trivy: { version: '1.0.0' } } }),
    ).toEqual([])
  })
})
