import { describe, expect, it } from 'vitest'

import {
  firewallArtifactPurls,
  isFirewallArtifactPath,
  parseFirewallArtifact,
} from '../../../../../src/util/firewall/policy/artifacts.mts'
import type { FirewallEcosystem } from '../../../../../src/util/firewall/policy/types.mts'

describe('firewall artifact parsing', () => {
  it.each([
    '1.2.3a1',
    '1.2.3b2',
    '1.2.3rc1',
    '1.2.3.post1',
    '1.2.3.dev123',
    '1!1.2.3',
    '1.2.3+local.1',
  ])('preserves Python version %s', version => {
    expect(
      parseFirewallArtifact(
        'pypi',
        `/packages/example_module-${version}.tar.gz`,
      ),
    ).toMatchObject({ name: 'example_module', version })
    expect(
      parseFirewallArtifact(
        'pypi',
        `/packages/example_module-${version}-cp313-cp313-manylinux_2_17_x86_64.manylinux2014_x86_64.whl.metadata`,
      ),
    ).toMatchObject({ name: 'example_module', version })
  })
  it.each<[FirewallEcosystem, string, string]>([
    [
      'npm',
      '/example-module/-/example-module-1.2.3.tgz',
      'pkg:npm/example-module@1.2.3',
    ],
    [
      'npm',
      '/@example%2fmodule/-/module-1.2.3.tgz',
      'pkg:npm/@example/module@1.2.3',
    ],
    [
      'npm',
      '/@example/module/-/@example/module-1.2.3.tgz',
      'pkg:npm/@example/module@1.2.3',
    ],
    [
      'pypi',
      '/packages/example_module-1.2.3-py3-none-any.whl',
      'pkg:pypi/example_module@1.2.3',
    ],
    [
      'pypi',
      '/packages/example_module-1!1.2.3.tar.gz',
      'pkg:pypi/example_module@1!1.2.3',
    ],
    [
      'golang',
      '/example.com/!example/module/@v/v1.2.3.zip',
      'pkg:golang/example.com/Example/module@v1.2.3',
    ],
    [
      'maven',
      '/maven2/org/example/module/1.2.3/module-1.2.3.jar',
      'pkg:maven/org.example/module@1.2.3',
    ],
    ['gem', '/gems/example-module-1.2.3.gem', 'pkg:gem/example-module@1.2.3'],
    [
      'gem',
      '/quick/Marshal.4.8/example-module-1.2.3.gemspec.rz',
      'pkg:gem/example-module@1.2.3',
    ],
    [
      'cargo',
      '/crates/example-module/1.2.3/download',
      'pkg:cargo/example-module@1.2.3',
    ],
    [
      'cargo',
      '/crates/example-module/example-module-1.2.3.crate',
      'pkg:cargo/example-module@1.2.3',
    ],
    [
      'cargo',
      '/api/v1/crates/example-module/1.2.3/download',
      'pkg:cargo/example-module@1.2.3',
    ],
    [
      'nuget',
      '/v3-flatcontainer/example.module/1.2.3/example.module.1.2.3.nupkg',
      'pkg:nuget/example.module@1.2.3',
    ],
  ])('parses %s artifact %s', (kind, path, expected) => {
    const artifact = parseFirewallArtifact(kind, path)
    expect(artifact).toBeDefined()
    expect(firewallArtifactPurls(artifact!)[0]).toBe(expected)
  })

  it('checks platform gems against both platform and ruby policy', () => {
    expect(
      firewallArtifactPurls(
        parseFirewallArtifact(
          'gem',
          '/gems/example-module-1.2.3-x86_64-linux.gem',
        )!,
      ),
    ).toEqual([
      'pkg:gem/example-module@1.2.3?platform=x86_64-linux',
      'pkg:gem/example-module@1.2.3?platform=ruby',
    ])
  })

  it.each<[FirewallEcosystem, string]>([
    ['npm', '/example-module/-/different-1.2.3.tgz'],
    ['npm', '/example-module/-/example-module-1.2.3.tgz/extra'],
    ['npm', '/example-module/%252d/example-module-1.2.3.tgz'],
    ['pypi', '/packages/invalid.whl'],
    ['golang', '/example.com/module/@v/bad.zip'],
    ['maven', '/module/bad/module.jar'],
    ['gem', '/gems/example-module-invalid.gem'],
    ['cargo', '/crates/example-module/bad/download'],
    [
      'nuget',
      '/v3-flatcontainer/example.module/1.2.3/example.module.1.2.3.nupkg/extra',
    ],
  ])('rejects malformed %s artifact %s', (kind, path) => {
    expect(parseFirewallArtifact(kind, path)).toBeUndefined()
    expect(isFirewallArtifactPath(kind, path)).toBe(true)
  })

  it.each<[FirewallEcosystem, string]>([
    ['npm', '/-/npm/v1/security/audits'],
    ['npm', '/-/ping'],
    ['pypi', '/simple/example-module/'],
    ['golang', '/example.com/module/@v/list'],
    ['gem', '/info/example-module'],
    ['cargo', '/config.json'],
    ['nuget', '/v3/index.json'],
  ])('allows %s metadata shape %s', (kind, path) => {
    expect(parseFirewallArtifact(kind, path)).toBeUndefined()
    expect(isFirewallArtifactPath(kind, path)).toBe(false)
  })
})
