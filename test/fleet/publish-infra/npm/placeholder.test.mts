import { describe, expect, it } from 'vitest'

import { expandNapiFamily } from '../../../../scripts/fleet/publish-infra/npm/placeholder.mts'

describe('expandNapiFamily', () => {
  it('expands a scoped meta-selector into the meta + 5 fleet-default platform packages', () => {
    const family = expandNapiFamily('@socketsecurity/ajar')
    expect(family).toEqual([
      '@socketsecurity/ajar',
      '@socketsecurity/ajar.node-darwin-arm64',
      '@socketsecurity/ajar.node-darwin-x64',
      '@socketsecurity/ajar.node-linux-arm64-gnu',
      '@socketsecurity/ajar.node-linux-x64-gnu',
      '@socketsecurity/ajar.node-win32-x64-msvc',
    ])
  })

  it('expands an unscoped meta-selector the same way', () => {
    const family = expandNapiFamily('decmpfs')
    expect(family?.[0]).toBe('decmpfs')
    expect(family).toHaveLength(6)
    expect(
      family?.every((n, i) => i === 0 || n.startsWith('decmpfs.node-')),
    ).toBe(true)
  })

  it('refuses a name that already carries a .node platform token', () => {
    expect(expandNapiFamily('@socketsecurity/ajar.node-darwin-arm64')).toBe(
      undefined,
    )
  })

  it('refuses .exe and .wasm implementation names', () => {
    expect(expandNapiFamily('@socketsecurity/cli.exe.darwin-arm64')).toBe(
      undefined,
    )
    expect(expandNapiFamily('@ultrathink/acorn.wasm')).toBe(undefined)
  })

  it('allows dots that are part of the base name rather than a target token', () => {
    const family = expandNapiFamily('@socketsecurity/node.js-helper')
    expect(family?.[0]).toBe('@socketsecurity/node.js-helper')
    expect(family).toHaveLength(6)
  })
})
