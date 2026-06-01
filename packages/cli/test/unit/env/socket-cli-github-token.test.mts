/**
 * Unit tests for SOCKET_CLI_GITHUB_TOKEN snapshot.
 *
 * The export runs at module-load time so it captures process.env once. Each
 * test resets module-state via vi.resetModules() and re-imports after setting
 * the env, so we can exercise the precedence chain.
 *
 * Test Coverage:
 *
 * - Socket-specific env var (via getSocketCliGithubToken) wins
 * - Falls back to GITHUB_TOKEN when Socket-specific is unset
 * - Falls back to GH_TOKEN when GITHUB_TOKEN is also unset
 * - Returns empty string when nothing is set
 *
 * Related Files:
 *
 * - Src/env/socket-cli-github-token.mts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'SOCKET_CLI_GITHUB_TOKEN',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (let i = 0, { length } = ENV_KEYS; i < length; i += 1) {
    const k = ENV_KEYS[i]
    saved[k] = process.env[k]
    delete process.env[k]
  }
  vi.resetModules()
})

afterEach(() => {
  for (let i = 0, { length } = ENV_KEYS; i < length; i += 1) {
    const k = ENV_KEYS[i]
    if (saved[k] === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = saved[k]
    }
  }
})

describe('env/socket-cli-github-token', () => {
  it('uses SOCKET_CLI_GITHUB_TOKEN when set', async () => {
    process.env['SOCKET_CLI_GITHUB_TOKEN'] = 'socket-test-fake-token'
    process.env['GITHUB_TOKEN'] = 'gh-test-fake-token'
    const mod =
      await import('../../../src/env/socket-cli-github-token.mts?cache_bust=1')
    expect(mod.SOCKET_CLI_GITHUB_TOKEN).toBe('socket-test-fake-token')
  })

  it('falls back to GITHUB_TOKEN when SOCKET_CLI_GITHUB_TOKEN is unset', async () => {
    process.env['GITHUB_TOKEN'] = 'gh-test-fake-token'
    process.env['GH_TOKEN'] = 'gh-test-fake-fallback'
    const mod =
      await import('../../../src/env/socket-cli-github-token.mts?cache_bust=2')
    expect(mod.SOCKET_CLI_GITHUB_TOKEN).toBe('gh-test-fake-token')
  })

  it('falls back to GH_TOKEN when GITHUB_TOKEN is also unset', async () => {
    process.env['GH_TOKEN'] = 'gh-test-fake-token'
    const mod =
      await import('../../../src/env/socket-cli-github-token.mts?cache_bust=3')
    expect(mod.SOCKET_CLI_GITHUB_TOKEN).toBe('gh-test-fake-token')
  })

  it('returns empty string when no env var is set', async () => {
    const mod =
      await import('../../../src/env/socket-cli-github-token.mts?cache_bust=4')
    expect(mod.SOCKET_CLI_GITHUB_TOKEN).toBe('')
  })
})
