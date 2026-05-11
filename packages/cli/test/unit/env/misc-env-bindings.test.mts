/**
 * Unit tests for misc env-binding modules.
 *
 * Each module re-exports a single env-derived value at module load.
 * These tests cover the import side-effect for coverage.
 *
 * Related Files:
 * - src/env/socket-cli-*.mts, node-env.mts, npm-config-user-agent.mts
 */

import { describe, expect, it } from 'vitest'

describe('socket-cli env bindings', () => {
  it.each([
    'socket-cli-accept-risks',
    'socket-cli-api-base-url',
    'socket-cli-api-proxy',
    'socket-cli-api-timeout',
    'socket-cli-api-token',
    'socket-cli-config',
    'socket-cli-no-api-token',
    'socket-cli-view-all-risks',
  ])('exports %s', async name => {
    const mod = await import(`../../../src/env/${name}.mts`)
    // The module must export at least one named binding.
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})

describe('process env bindings', () => {
  it.each(['node-env', 'npm-config-user-agent'])('exports %s', async name => {
    const mod = await import(`../../../src/env/${name}.mts`)
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})

describe('socket-cli-* env bindings (additional)', () => {
  it.each([
    'socket-cli-bin-path',
    'socket-cli-bootstrap-cache-dir',
    'socket-cli-bootstrap-spec',
    'socket-cli-cdxgen-local-path',
    'socket-cli-coana-local-path',
    'socket-cli-debug',
    'socket-cli-fix',
    'socket-cli-git-user-email',
    'socket-cli-git-user-name',
    'socket-cli-js-path',
    'socket-cli-local-node-smol',
    'socket-cli-local-path',
    'socket-cli-mode',
    'socket-cli-models-path',
    'socket-cli-npm-path',
    'socket-cli-optimize',
    'socket-cli-org-slug',
    'socket-cli-pycli-local-path',
    'socket-cli-python-path',
    'socket-cli-sea-node-version',
    'socket-cli-sfw-local-path',
    'socket-cli-skip-update-check',
    'socket-cli-socket-patch-local-path',
  ])('exports %s', async name => {
    const mod = await import(`../../../src/env/${name}.mts`)
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})

describe('process / system env bindings', () => {
  it.each([
    'ci',
    'cli-homepage',
    'cli-name',
    'disable-github-cache',
    'home',
    'is-published-build',
    'is-sentry-build',
    'localappdata',
    'node-options',
    'npm-config-cache',
    'prebuilt-node-download-url',
    'run-e2e-tests',
    'run-integration-tests',
    'temp',
    'term',
    'tmp',
    'userprofile',
    'vitest',
    'xdg-cache-home',
    'xdg-data-home',
  ])('exports %s', async name => {
    const mod = await import(`../../../src/env/${name}.mts`)
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})

describe('python build env bindings', () => {
  it.each(['python-build-tag', 'cdxgen-version'])('exports %s', async name => {
    const mod = await import(`../../../src/env/${name}.mts`)
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})
