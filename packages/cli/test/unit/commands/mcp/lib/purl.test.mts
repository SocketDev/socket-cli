/**
 * Unit tests for the MCP command's PURL builder.
 *
 * Tests buildPurl(ecosystem, depname, version) — a thin wrapper around
 * @socketregistry/packageurl-js that handles per-ecosystem
 * namespace/name splitting (npm scoped @scope/name, maven
 * groupId:artifactId, golang module path).
 *
 * Test Coverage:
 * - Bare names across all ecosystems (npm, pypi, gem, cargo, nuget, etc.)
 * - npm scoped names: @scope/name → namespace=@scope, name=name
 * - npm scoped without slash: @something stays as bare name
 * - maven coords with `:` separator: groupId:artifactId
 * - maven coords with `/` separator: groupId/artifactId
 * - golang nested paths: github.com/user/repo → namespace=github.com/user, name=repo
 * - golang single-segment: bare name
 * - Sentinel versions (`unknown`, `1.0.0`, '') → omitted from PURL
 * - Real version preserved
 * - Ecosystem case folded to lowercase (NPM → npm)
 *
 * Related Files:
 * - src/commands/mcp/lib/purl.mts - Implementation
 * - src/commands/mcp/lib/artifacts.mts - Sister helper for response dedup
 */

import { describe, expect, it } from 'vitest'

import { buildPurl } from '../../../../../src/commands/mcp/lib/purl.mts'

describe('buildPurl', () => {
  describe('npm ecosystem', () => {
    it('builds a bare PURL for an unscoped name', () => {
      expect(buildPurl('npm', 'lodash', '4.17.21')).toBe(
        'pkg:npm/lodash@4.17.21',
      )
    })

    it('splits @scope/name into namespace + name', () => {
      expect(buildPurl('npm', '@socketsecurity/sdk', '4.0.1')).toBe(
        'pkg:npm/%40socketsecurity/sdk@4.0.1',
      )
    })

    it('throws on a bare @something without a slash (rejected by packageurl-js)', () => {
      // packageurl-js rejects `@` characters in npm names that aren't part
      // of a valid scope. The MCP tool input schema doesn't pre-validate
      // depnames, so callers can hit this path with malformed input.
      // Documenting current behavior — rethrow surfaces as a SDK error.
      expect(() => buildPurl('npm', '@notscoped', '1.2.3')).toThrow(
        /Invalid purl: npm/,
      )
    })

    it('omits version when version is "unknown"', () => {
      expect(buildPurl('npm', 'express', 'unknown')).toBe('pkg:npm/express')
    })

    it('omits version when version is "1.0.0" (placeholder sentinel)', () => {
      expect(buildPurl('npm', 'foo', '1.0.0')).toBe('pkg:npm/foo')
    })

    it('omits version when version is empty string', () => {
      expect(buildPurl('npm', 'bar', '')).toBe('pkg:npm/bar')
    })
  })

  describe('maven ecosystem', () => {
    it('splits groupId:artifactId on `:`', () => {
      expect(
        buildPurl('maven', 'org.springframework:spring-core', '6.1.0'),
      ).toBe('pkg:maven/org.springframework/spring-core@6.1.0')
    })

    it('splits groupId/artifactId on `/`', () => {
      expect(buildPurl('maven', 'com.example/my-lib', '2.0.0')).toBe(
        'pkg:maven/com.example/my-lib@2.0.0',
      )
    })

    it('prefers `:` over `/` when both are present', () => {
      // First `:` wins for the split, so `a:b/c` → namespace=a, name=b/c
      const result = buildPurl('maven', 'a:b/c', '1.0')
      expect(result).toContain('pkg:maven/a/')
      expect(result).toContain('@1.0')
    })

    it('throws on a bare maven name without a groupId (purl spec requires namespace for maven)', () => {
      // The PURL spec mandates a namespace component for maven; without
      // a `:` or `/` in the depname there's no groupId to derive.
      expect(() => buildPurl('maven', 'standalone', '1.2.3')).toThrow(
        /maven requires a "namespace"/,
      )
    })
  })

  describe('golang ecosystem', () => {
    it('splits a deep module path on the last slash', () => {
      // packageurl-js preserves namespace slashes literally for golang.
      expect(
        buildPurl('golang', 'github.com/socketdev/socket-cli', 'v1.0.0'),
      ).toBe('pkg:golang/github.com/socketdev/socket-cli@v1.0.0')
    })

    it('treats a single-segment module as bare name', () => {
      expect(buildPurl('golang', 'context', 'v1.2.3')).toBe(
        'pkg:golang/context@v1.2.3',
      )
    })
  })

  describe('other ecosystems (no special handling)', () => {
    it('builds a bare pypi PURL', () => {
      expect(buildPurl('pypi', 'requests', '2.31.0')).toBe(
        'pkg:pypi/requests@2.31.0',
      )
    })

    it('builds a bare gem PURL', () => {
      expect(buildPurl('gem', 'rails', '7.1.0')).toBe('pkg:gem/rails@7.1.0')
    })

    it('builds a bare cargo PURL (1.0.0 is treated as a placeholder)', () => {
      // The buildPurl helper treats `1.0.0` as a placeholder (matching
      // upstream socket-mcp behavior) and omits it. Real Cargo crates
      // pin to specific versions in practice, so this matches how the
      // depscore tool gets called.
      expect(buildPurl('cargo', 'serde', '1.0.0')).toBe('pkg:cargo/serde')
    })

    it('preserves real cargo versions other than 1.0.0', () => {
      expect(buildPurl('cargo', 'serde', '1.0.193')).toBe(
        'pkg:cargo/serde@1.0.193',
      )
    })

    it('builds a bare nuget PURL', () => {
      expect(buildPurl('nuget', 'Newtonsoft.Json', '13.0.3')).toBe(
        'pkg:nuget/Newtonsoft.Json@13.0.3',
      )
    })
  })

  describe('ecosystem case folding', () => {
    it('lowercases the ecosystem so NPM works the same as npm', () => {
      expect(buildPurl('NPM', 'left-pad', '1.3.0')).toBe(
        'pkg:npm/left-pad@1.3.0',
      )
    })

    it('lowercases mixed-case PyPI ecosystem (and lowercases the package name per PURL spec)', () => {
      // Per the packageurl spec, pypi names are case-insensitive and are
      // canonicalized to lowercase by packageurl-js.
      expect(buildPurl('PyPI', 'Django', '5.0.0')).toBe('pkg:pypi/django@5.0.0')
    })
  })

  describe('version handling', () => {
    it('preserves a real semver string', () => {
      expect(buildPurl('npm', 'foo', '4.2.0')).toBe('pkg:npm/foo@4.2.0')
    })

    it('preserves a pre-release version', () => {
      expect(buildPurl('npm', 'foo', '4.2.0-beta.1')).toBe(
        'pkg:npm/foo@4.2.0-beta.1',
      )
    })
  })
})
