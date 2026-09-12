import { describe, expect, it } from 'vitest'

import {
  parseFirewallApiDecision,
  readFirewallApiResponse,
} from '../../../../../src/util/firewall/policy/api.mts'
import {
  parseFirewallRegistry,
  resolveFirewallRegistry,
} from '../../../../../src/util/firewall/policy/registries.mts'

const purl = 'pkg:npm/example-module@1.2.3'

describe('firewall API validation', () => {
  it('rejects contradictory package identities even when inputPurl matches', () => {
    expect(() =>
      parseFirewallApiDecision(
        JSON.stringify({
          type: 'npm',
          name: 'different-module',
          version: '1.2.3',
          inputPurl: purl,
          alerts: [],
        }),
        purl,
      ),
    ).toThrow()
  })
  it('matches Maven group identities with dotted namespaces', () => {
    const artifact = {
      type: 'maven',
      namespace: 'org.example',
      name: 'module',
      version: '1.2.3',
      alerts: [],
    }
    expect(
      parseFirewallApiDecision(
        JSON.stringify(artifact),
        'pkg:maven/org.example/module@1.2.3',
      ),
    ).toMatchObject({ blocked: false })
  })
  it('compares scoped package identities with canonical PURL decoding', () => {
    const artifact = {
      type: 'npm',
      namespace: '@example',
      name: 'module',
      version: '1.2.3',
      alerts: [],
    }
    expect(
      parseFirewallApiDecision(
        JSON.stringify(artifact),
        'pkg:npm/%40example/module@1.2.3',
      ),
    ).toMatchObject({ blocked: false })
    expect(
      parseFirewallApiDecision(
        JSON.stringify({
          ...artifact,
          inputPurl: 'pkg:npm/%40example/module@1.2.3',
        }),
        'pkg:npm/@example/module@1.2.3',
      ),
    ).toMatchObject({ blocked: false })
  })
  it('matches unlabelled responses by package identity', () => {
    expect(
      parseFirewallApiDecision(
        JSON.stringify({
          type: 'npm',
          name: 'example-module',
          version: '1.2.3',
          alerts: [],
        }),
        purl,
      ),
    ).toEqual({ blocked: false, reasons: [] })
    expect(() =>
      parseFirewallApiDecision(
        JSON.stringify({
          type: 'npm',
          name: 'different-module',
          version: '1.2.3',
          alerts: [],
        }),
        purl,
      ),
    ).toThrow()
  })

  it('rejects mismatched input purls and malformed alerts', () => {
    for (const data of [
      { inputPurl: 'pkg:npm/different-module@1.2.3', alerts: [] },
      { alerts: [false] },
      { alerts: [{ type: 'malware', action: 1 }] },
      { alerts: [{}] },
    ]) {
      expect(() =>
        parseFirewallApiDecision(
          JSON.stringify({
            name: 'example-module',
            type: 'npm',
            version: '1.2.3',
            ...data,
          }),
          purl,
        ),
      ).toThrow()
    }
  })

  it('aggregates NDJSON result lines', () => {
    const artifact = {
      name: 'example-module',
      type: 'npm',
      version: '1.2.3',
      inputPurl: purl,
    }
    expect(
      parseFirewallApiDecision(
        [
          JSON.stringify({
            ...artifact,
            alerts: [{ type: 'usesEval', action: 'warn' }],
          }),
          JSON.stringify({
            ...artifact,
            alerts: [{ type: 'malware', action: 'error' }],
          }),
        ].join('\n'),
        purl,
      ),
    ).toEqual({ blocked: true, reasons: ['warn: usesEval', 'error: malware'] })
  })

  it('rejects HTTP errors and oversized response streams', async () => {
    await expect(
      readFirewallApiResponse(new Response('unavailable', { status: 503 })),
    ).rejects.toThrow()
    await expect(
      readFirewallApiResponse(new Response('example'.repeat(700_000))),
    ).rejects.toThrow()
  })
})

describe('firewall registry routing', () => {
  it('keeps exact host restrictions above wildcard rules after authority normalization', () => {
    const custom = [
      parseFirewallRegistry('block:a.example.com'),
      parseFirewallRegistry('bypass:*.example.com'),
    ]
    expect(
      resolveFirewallRegistry(new URL('https://a.example.com.:8443'), custom)
        ?.kind,
    ).toBe('block')
  })
  it('matches wildcard hosts on a dot boundary', () => {
    const custom = [parseFirewallRegistry('npm:*.example.com/packages')]
    expect(
      resolveFirewallRegistry(
        new URL('https://registry.example.com/packages/example-module'),
        custom,
      )?.kind,
    ).toBe('npm')
    expect(
      resolveFirewallRegistry(
        new URL('https://registry.example.com/packages-evil/example-module'),
        custom,
      )?.kind,
    ).toBe('block')
    expect(
      resolveFirewallRegistry(
        new URL('https://badexample.com/packages/example-module'),
        custom,
      ),
    ).toBeUndefined()
  })

  it('chooses the longest prefix and respects protocol and port', () => {
    const custom = [
      parseFirewallRegistry('npm:https://example.com:8443/packages'),
      parseFirewallRegistry('pypi:https://example.com:8443/packages/python'),
    ]
    expect(
      resolveFirewallRegistry(
        new URL('https://example.com:8443/packages/python/example.whl'),
        custom,
      )?.kind,
    ).toBe('pypi')
    expect(
      resolveFirewallRegistry(
        new URL('http://example.com:8443/packages/example-module'),
        custom,
      )?.kind,
    ).toBe('block')
    expect(
      resolveFirewallRegistry(
        new URL('https://example.com/packages/example-module'),
        custom,
      ),
    ).toMatchObject({ kind: 'block' })
  })
})
