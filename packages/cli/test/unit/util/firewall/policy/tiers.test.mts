import { describe, expect, it, vi } from 'vitest'

import { createFirewallPolicy } from '../../../../../src/util/firewall/policy/index.mts'
import {
  FIREWALL_ENTERPRISE_ECOSYSTEMS,
  FIREWALL_ENTERPRISE_INFRASTRUCTURE,
} from '../../../../../src/util/firewall/policy/tiers.mts'

describe('firewall wrapper tiers', () => {
  it('emits one ecosystem notice even when unknown hosts use warning mode', () => {
    const onWarning = vi.fn()
    const policy = createFirewallPolicy({
      onWarning,
      unknownHostAction: 'warn',
    })
    policy.resolveDestination(new URL('https://hex.pm'))
    policy.resolveDestination(new URL('https://repo.hex.pm'))
    expect(onWarning).not.toHaveBeenCalled()
    policy.close()
    expect(onWarning).toHaveBeenCalledTimes(1)
  })
  it('keeps telemetry disabled in both tiers', () => {
    for (const policy of [
      createFirewallPolicy(),
      createFirewallPolicy({ apiToken: 'example-placeholder-token' }),
    ]) {
      expect(
        policy.resolveDestination(
          new URL('https://eu-central-1-1.aws.cloud2.influxdata.com'),
        ),
      ).toBe('block')
    }
  })
  it('scans supported ecosystem hosts in both tiers', () => {
    for (const policy of [
      createFirewallPolicy(),
      createFirewallPolicy({ apiToken: 'example-placeholder-token' }),
    ]) {
      for (const host of [
        'registry.npmjs.org',
        'pypi.org',
        'proxy.golang.org',
        'repo.maven.apache.org',
        'rubygems.org',
        'static.crates.io',
        'api.nuget.org',
      ]) {
        expect(policy.resolveDestination(new URL(`https://${host}`))).toBe(
          'inspect',
        )
      }
      policy.close()
    }
  })

  it('permits enterprise toolchains and infrastructure without claiming scanning', () => {
    const policy = createFirewallPolicy({
      apiToken: 'example-placeholder-token',
    })
    for (const host of [
      ...FIREWALL_ENTERPRISE_ECOSYSTEMS.keys(),
      ...FIREWALL_ENTERPRISE_INFRASTRUCTURE,
    ]) {
      expect(policy.resolveDestination(new URL(`https://${host}`))).toBe(
        'bypass',
      )
    }
    expect(policy.getTunneledEcosystems()).toEqual([])
    expect(
      policy.resolveDestination(new URL('https://unconfigured.example.com')),
    ).toBe('block')
  })

  it('retains free-only infrastructure dispositions', () => {
    const free = createFirewallPolicy({ unknownHostAction: 'block' })
    const enterprise = createFirewallPolicy({
      apiToken: 'example-placeholder-token',
    })
    for (const host of [
      'api.github.com',
      'nodejs.org',
      'npm.fontawesome.com',
    ]) {
      expect(free.resolveDestination(new URL(`https://${host}`))).toBe('bypass')
      expect(enterprise.resolveDestination(new URL(`https://${host}`))).toBe(
        'block',
      )
    }
  })

  it('consolidates free tunneled ecosystem notices once per wrapper and retains JSON data', () => {
    const onWarning = vi.fn()
    const policy = createFirewallPolicy({ onWarning })
    for (const host of [
      'conda.anaconda.org',
      'conda.anaconda.org',
      'ANACONDA.ORG.',
      'cdn.cocoapods.org',
      'raw.githubusercontent.com',
      'unconfigured.example.com',
      'cmake.org',
    ]) {
      expect(policy.resolveDestination(new URL(`https://${host}`))).toBe(
        'bypass',
      )
    }
    expect(onWarning).not.toHaveBeenCalled()
    const expected = [
      { ecosystem: 'CocoaPods', hosts: ['cdn.cocoapods.org'] },
      { ecosystem: 'Conda', hosts: ['anaconda.org', 'conda.anaconda.org'] },
    ]
    expect(policy.getTunneledEcosystems()).toEqual(expected)
    policy.close()
    policy.close()
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(policy.getTunneledEcosystems()).toEqual(expected)
  })

  it('does not report blocked ecosystem traffic or CDN fallback traffic as scanned', () => {
    const onWarning = vi.fn()
    const blocked = createFirewallPolicy({
      onWarning,
      unknownHostAction: 'block',
    })
    expect(blocked.resolveDestination(new URL('https://hex.pm'))).toBe('block')
    blocked.close()
    const free = createFirewallPolicy({ onWarning })
    expect(
      free.resolveDestination(new URL('https://raw.githubusercontent.com')),
    ).toBe('bypass')
    free.close()
    expect(onWarning).not.toHaveBeenCalled()
  })
})

describe('operator-declared local registry aliases', () => {
  it('demotes only declared built-in registry hostnames', () => {
    const policy = createFirewallPolicy({
      localRegistryAliases: ['Registry.NPMJS.org.'],
    })
    expect(
      policy.resolveDestination(new URL('https://registry.npmjs.org:8443')),
    ).toBe('bypass')
    expect(
      policy.resolveDestination(new URL('https://REGISTRY.NPMJS.ORG..')),
    ).toBe('bypass')
    expect(policy.resolveDestination(new URL('https://pypi.org'))).toBe(
      'inspect',
    )
    expect(
      createFirewallPolicy().resolveDestination(
        new URL('https://registry.npmjs.org:8443'),
      ),
    ).toBe('inspect')
  })

  it('applies unknown-host policy to declared built-in aliases', () => {
    const policy = createFirewallPolicy({
      apiToken: 'example-placeholder-token',
      localRegistryAliases: ['registry.npmjs.org'],
    })
    expect(
      policy.resolveDestination(new URL('https://registry.npmjs.org')),
    ).toBe('block')
  })

  it('never demotes configured custom registry hosts or custom overrides', () => {
    const policy = createFirewallPolicy({
      customRegistries: ['npm:registry.example.com', 'npm:registry.npmjs.org'],
      localRegistryAliases: ['registry.example.com', 'registry.npmjs.org'],
    })
    expect(
      policy.resolveDestination(new URL('https://registry.example.com')),
    ).toBe('inspect')
    expect(
      policy.resolveDestination(new URL('https://registry.npmjs.org')),
    ).toBe('inspect')
  })
})
