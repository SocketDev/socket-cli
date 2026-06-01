# No live network in tests

Tests must never open a connection to a third-party server. Live calls are
flaky (a slow or blocked network turns a green suite red), slow (a 15s timeout
beats a 2ms mock), non-deterministic (the remote's data changes under you), and
a privacy/data-exfil surface (a test that talks to `api.anaconda.org` leaks that
the suite ran, and to whom). Mock the HTTP layer instead.

## The pattern

Use [`nock`](https://github.com/nock/nock). Disable real connections in
`beforeEach`, stub each endpoint the code under test will hit, and restore in
`afterEach`. The `registry-*.test.mts` suites are the canonical reference:

```ts
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('cranExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })
  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  it('resolves an existing package', async () => {
    nock('https://cran.r-universe.dev')
      .get('/api/packages/ggplot2')
      .reply(200, { Version: '3.4.4', versions: ['3.4.4'] })

    expect(await cranExists('ggplot2')).toEqual({
      exists: true,
      latestVersion: '3.4.4',
    })
  })
})
```

A "does it dispatch to the right handler" routing test still needs a stub — the
handler makes the call regardless of what you assert. Stub it with a catch-all
(`nock(host).get(/.*/).reply(200, {})`) so the routing assertion runs offline.

## Defense in depth

Three layers enforce this:

1. **Runtime fail-closed** — the fleet `test/scripts/fleet/setup.mts` (wired via
   vitest `setupFiles`) calls `nock.disableNetConnect()` once, allowing only
   `127.0.0.1` / `localhost` (for fixture servers). Any unmocked request throws
   `NetConnectNotAllowedError` at run time, so a missing stub fails loudly
   instead of silently reaching the internet.
2. **Edit-time hook** — `.claude/hooks/fleet/no-unmocked-network-in-tests-guard/`
   blocks a Write/Edit to a `*.test.*` file that calls `httpJson` / `httpText` /
   `fetch` / `request` against a non-localhost host with no `nock` reference in
   the file. Catches it as you author.
3. **This doc + the CLAUDE.md rule** — the policy itself.

Skill is docs, hook is edit-time, runtime setup is the gate. Each catches what
the others miss.

## Bypass

Genuinely need a live connection (an opt-in integration test gated behind an env
var, a localhost fixture server)? Type `Allow unmocked-network-in-tests bypass`
verbatim. Localhost is always allowed without a bypass.

## Why this rule exists

2026-05-27, socket-packageurl-js: the `purlExists` conda and docker dispatch
tests called `api.anaconda.org` and `hub.docker.com` directly — the test comment
read "Network call may succeed or fail." When the network was slow they timed
out at 15s and turned the suite red. The fix was to `nock`-mock the endpoints
like every `registry-*.test.mts` already did. Promoted to a fleet rule so the
next repo doesn't relearn it.
