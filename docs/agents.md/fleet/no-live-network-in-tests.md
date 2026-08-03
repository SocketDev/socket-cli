# No live network in tests

Unit tests must never open a connection to a third-party server, in **any**
fleet language: js/ts, rust, go, c++. Live calls are flaky: a slow or blocked
network turns a green suite red; slow: a 15s timeout beats a 2ms mock;
non-deterministic: the remote's data changes under you; and a privacy/data-exfil
surface: a test that talks to `api.anaconda.org` leaks that the suite ran, and to
whom. Mock the boundary; run the suite as if the network is off.

## Two halves: mock the boundary, and gate it

1. **Mock** the HTTP/socket boundary in the test so the code under test talks to
   a local stub, not the internet.
2. **Gate** the run so an *un*mocked call fails loudly instead of silently
   reaching out. The gate is what keeps the mock honest — a missing stub becomes
   a red test, not a live request.

Localhost (`127.0.0.1` / `localhost`) is always allowed — fixture servers bind
there.

## Per-language pattern

### js/ts — [`nock`](https://github.com/nock/nock)

Disable real connections in `beforeEach`, stub each endpoint, restore in
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

### rust — [`mockito`](https://docs.rs/mockito) / [`wiremock`](https://docs.rs/wiremock)

Spin a mock server bound to loopback and point the client at its URL; assert on
the mock. Never hit a real host from a `#[test]`. Prefer injecting the base URL
so the test can pass the mock's address.

### go — [`net/http/httptest`](https://pkg.go.dev/net/http/httptest)

`httptest.NewServer` gives a loopback server; pass its `.URL` to the code under
test. Never dial a real host from a `Test*` function.

### c++ — framework mocks (gmock / a local fixture server)

Mock the HTTP client interface, or stand up a loopback fixture server the test
controls. Never reach a real host from a unit test.

## Never background a test/build/commit run

A test or build run, and the `git commit`/`rebase`/`merge`/`cherry-pick` that
triggers the pre-commit test reminder, must run in the FOREGROUND. Backgrounding
one via `Bash(run_in_background: true)` hides the run's completion, so the
operator checks too early, sees it "still going", and reaches for a `pkill`/
`kill` that tears down a mid-hook process — leaving a stale `.git/index.lock`
and orphaned worker processes behind. `.claude/hooks/fleet/no-premature-commit-kill-guard/`
blocks both halves: backgrounding a `git commit`/`rebase`/`merge`/`cherry-pick`,
and a `pkill`/`kill`/`killall` targeting a `git commit`/`git push`, a
pre-commit/pre-push hook process, or a `vitest` run (the worker-scoped
`vitest/dist/workers` reap is exempt).

Two Stop-hooks clean up what still accumulates: `stale-process-sweeper` reaps
orphaned Node test/build workers that lost their parent, and `sweep-ds-store`
removes stray `.DS_Store` files created mid-session. `no-hook-cmd-regex-guard`
blocks a new regex literal parsing a shell command inside `.claude/hooks/**`,
forcing the shared AST-based `shell-command.mts` parser instead of a fragile
pattern match.

`no-unmocked-ai-guard` is the AI-surface sibling of `no-unmocked-net-guard`: it
blocks a test file that calls the fleet's AI-spawn helper (`spawnAiAgent`) with
no `vi.mock(` in the same content, since a real model call from a test is slow,
costly, and non-deterministic in the same way a live HTTP call is.

## Defense in depth

Three layers enforce this. Each catches what the others miss.

1. **Runtime fail-closed.**
   - *js/ts*: `test/fleet/scripts/setup.mts` (vitest `setupFiles`) calls
     `nock.disableNetConnect()` once, allowing only `127.0.0.1` / `localhost`.
     Any unmocked request throws `NetConnectNotAllowedError` at run time.
   - *rust / go / c++*: the CI test step runs inside the `run-offline` composite
     action (`.github/actions/fleet/run-offline`) — a network namespace with only
     loopback up, so an unmocked outbound call has no route and fails. Deps are
     fetched online *before* the sandbox; the sandbox wraps only the test run.
     Fail-closed: if no namespace can be created the step errors, it never
     silently runs with the network up.
2. **Edit-time hook** — `.claude/hooks/fleet/no-unmocked-net-guard/` blocks a
   Write/Edit to a `*.test.*` file that calls `httpJson` / `httpText` / `fetch` /
   `request` against a non-localhost host with no `nock` reference. Catches it as
   you author (js/ts).
3. **CI check** — `scripts/fleet/check/native-tests-are-network-off.mts` scans a
   repo's workflows for native test invocations (`cargo test` / `cargo nextest`,
   `go test`, `ctest` / `cmake --build … test`) and requires each is wrapped by
   the `run-offline` action. Runs in `check --all`.

## Using the sandbox action

Wrap the native test step. Pre-fetch deps online first (the sandbox has no
route), then run the tests offline:

```yaml
- name: pre-fetch deps (online, before the sandbox)
  run: cargo fetch --locked
- name: test (network-off)
  uses: ./.github/actions/fleet/run-offline
  with:
    run: cargo test --workspace --all-features --offline
```

On non-Linux runners, a macos/windows matrix leg, the action runs the command
normally — network behavior is OS-independent, so the Linux job is the gate.

## Mechanism notes (rust/go/c++ sandbox)

- Ubuntu 24.04 restricts unprivileged user namespaces via AppArmor; the action
  relaxes it with `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0`
  on the ephemeral runner before `unshare --map-root-user --net`.
- A fresh net namespace has loopback down — the action brings `lo` up so
  localhost fixtures work. `--map-root-user` keeps test artifacts owned by the
  runner user (no root-owned `target/` breaking the cache-save step).

## Bypass

Genuinely need a live connection (an opt-in integration test gated behind an env
var, a localhost fixture server)? Type `Allow unmocked-network-in-tests bypass`
verbatim. Localhost is always allowed without a bypass.

## Why this rule exists

2026-05-27, socket-packageurl-js: the `purlExists` conda and docker dispatch
tests called `api.anaconda.org` and `hub.docker.com` directly — the test comment
read "Network call may succeed or fail." When the network was slow they timed
out at 15s and turned the suite red. The fix was to `nock`-mock the endpoints
like every `registry-*.test.mts` already did. Promoted to a fleet rule, then
extended to the native languages so a rust/go/c++ repo gets the same guarantee
the js/ts suites already have.
