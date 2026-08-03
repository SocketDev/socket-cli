/**
 * Unit tests for the socket.dev report URL builder.
 *
 * The namespace rendering differs per ecosystem, and getting it wrong produces
 * a link that 404s, so each shape is pinned.
 *
 * Related Files: - src/commands/mcp/lib/socket-report-url.mts.
 */

import { describe, expect, it } from 'vitest'

import { buildSocketReportUrl } from '../../../../../src/commands/mcp/lib/socket-report-url.mts'

describe('buildSocketReportUrl', () => {
  it('builds an unscoped npm URL', () => {
    expect(buildSocketReportUrl({ name: 'lodash', type: 'npm' })).toBe(
      'https://socket.dev/npm/package/lodash',
    )
  })

  it('renders an npm namespace as an @scope', () => {
    expect(
      buildSocketReportUrl({ name: 'core', namespace: 'babel', type: 'npm' }),
    ).toBe('https://socket.dev/npm/package/@babel/core')
  })

  it.each(['pypi', 'gem', 'nuget', 'cargo'])(
    'drops the namespace for the flat registry %s',
    ecosystem => {
      expect(
        buildSocketReportUrl({
          name: 'requests',
          namespace: 'ignored',
          type: ecosystem,
        }),
      ).toBe(`https://socket.dev/${ecosystem}/package/requests`)
    },
  )

  it('joins a golang namespace on a slash', () => {
    expect(
      buildSocketReportUrl({
        name: 'mux',
        namespace: 'github.com/gorilla',
        type: 'golang',
      }),
    ).toBe('https://socket.dev/golang/package/github.com/gorilla/mux')
  })

  it('joins a maven namespace on a slash', () => {
    expect(
      buildSocketReportUrl({
        name: 'spring-core',
        namespace: 'org.springframework',
        type: 'maven',
      }),
    ).toBe('https://socket.dev/maven/package/org.springframework/spring-core')
  })

  it('lowercases the ecosystem', () => {
    expect(buildSocketReportUrl({ name: 'lodash', type: 'NPM' })).toContain(
      '/npm/package/',
    )
  })

  it('defaults a missing ecosystem to npm', () => {
    expect(buildSocketReportUrl({ name: 'lodash' })).toBe(
      'https://socket.dev/npm/package/lodash',
    )
  })

  it('falls back to unknown for a missing name', () => {
    expect(buildSocketReportUrl({ type: 'npm' })).toBe(
      'https://socket.dev/npm/package/unknown',
    )
  })

  it('ignores an empty namespace', () => {
    expect(
      buildSocketReportUrl({ name: 'lodash', namespace: '', type: 'npm' }),
    ).toBe('https://socket.dev/npm/package/lodash')
  })
})
