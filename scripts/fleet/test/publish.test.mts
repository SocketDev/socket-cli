// node --test specs for scripts/fleet/publish.mts isStagingExpected().
//
// Covers the four behaviors that gate the --direct refusal path:
//
//   1. First-publish (registry returns empty `versions` object) → false
//   2. Prior version carries `_npmUser.approver` → true (refuses --direct)
//   3. Prior version has `_npmUser` but no `approver` → false
//   4. Network failure / 404 → false (don't block --direct on a registry blip)
//
// Mocking strategy: globalThis.fetch is the only external surface
// inside isStagingExpected (via fetchVersionTrustInfo). Each test
// swaps it for a stub that returns a tailored Response shape, then
// restores the original in a finally block. The pattern keeps the
// tests hermetic (no network) without pulling in a test framework.

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { isStagingExpected } from '../publish.mts'

const ORIGINAL_FETCH = globalThis.fetch

function installFetch(body: unknown, ok = true): void {
  globalThis.fetch = (async (): Promise<Response> => {
    return new Response(JSON.stringify(body), {
      status: ok ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

function installFetchError(): void {
  globalThis.fetch = (async (): Promise<Response> => {
    throw new Error('simulated network failure')
  }) as typeof fetch
}

describe('publish / isStagingExpected', () => {
  beforeEach(() => {
    // Reset between tests so a failed installFetch doesn't leak.
    globalThis.fetch = ORIGINAL_FETCH
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  test('first-publish (no versions) returns false', async () => {
    installFetch({ versions: {} })
    const result = await isStagingExpected('@some/never-published')
    assert.equal(result, false)
  })

  test('prior version with `_npmUser.approver` returns true', async () => {
    installFetch({
      versions: {
        '1.0.0': {
          _npmUser: { approver: 'human-approver-id' },
        },
      },
    })
    const result = await isStagingExpected('@some/staged-package')
    assert.equal(result, true)
  })

  test('prior version with `_npmUser` but no approver returns false', async () => {
    installFetch({
      versions: {
        '1.0.0': {
          _npmUser: { name: 'someone' },
        },
      },
    })
    const result = await isStagingExpected('@some/direct-only')
    assert.equal(result, false)
  })

  test('mix: at least one version with approver returns true', async () => {
    // Real-world packages migrate from --direct to --staged mid-history.
    // ANY version with an approver is the signal we want to preserve.
    installFetch({
      versions: {
        '1.0.0': { _npmUser: { name: 'old' } },
        '1.1.0': { _npmUser: { approver: 'new-approver' } },
        '1.2.0': { _npmUser: { name: 'subsequent' } },
      },
    })
    const result = await isStagingExpected('@some/mixed-history')
    assert.equal(result, true)
  })

  test('network failure returns false (does not block --direct)', async () => {
    installFetchError()
    const result = await isStagingExpected('@some/whatever')
    assert.equal(result, false)
  })

  test('404 response returns false', async () => {
    installFetch({}, /* ok */ false)
    const result = await isStagingExpected('@some/not-on-registry')
    assert.equal(result, false)
  })

  test('malformed JSON in response returns false', async () => {
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response('not-json-at-all', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const result = await isStagingExpected('@some/malformed')
    assert.equal(result, false)
  })
})

describe('publish / main-guard', () => {
  test('importing the module does not run main()', async () => {
    // The main-guard is `if (process.argv[1] === fileURLToPath(import.meta.url))`.
    // When this test file imports `../publish.mts`, process.argv[1] points at
    // the node:test runner — not at publish.mts — so main() must not run.
    // If the guard regressed (e.g. someone deleted the `if` branch), the
    // import would trigger a real publish-prep run: read package.json,
    // probe npm registry, spawn child processes. That's catastrophic in a
    // test context.
    //
    // We assert two things: (1) the import resolves without throwing,
    // (2) the resolved module exports the public API. If main() ran
    // synchronously at import time, throws inside it would either reject
    // the import promise OR `process.exitCode = 1` would set, both of
    // which would fail this test.
    const mod = await import('../publish.mts')
    assert.equal(typeof mod.isStagingExpected, 'function')
    // exitCode is 0 (or undefined) when nothing has set it; a regressed
    // main-guard would have run main() which sets exitCode on error.
    assert.ok(
      process.exitCode === 0 || process.exitCode === undefined,
      `process.exitCode is ${process.exitCode}; main() likely ran during import`,
    )
  })

  test("process.argv[1] doesn't match import.meta.url under test runner", () => {
    // Sanity check the test environment: the runner's argv[1] is the
    // test entry, not publish.mts itself. If this assumption changes
    // (e.g. a different test runner), the main-guard test above could
    // give a false-positive pass.
    const fileURLToPath = (url: string): string =>
      new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    const publishUrl = new URL('../publish.mts', import.meta.url).href
    assert.notEqual(process.argv[1], fileURLToPath(publishUrl))
  })
})
