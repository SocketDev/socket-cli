# no-unmocked-net-guard

PreToolUse hook. Blocks a Write/Edit to a test file that performs HTTP against a
third-party host without mocking it via [`nock`](https://github.com/nock/nock).

Live network in tests is flaky, slow, and a data-exfil surface. The fleet
pattern is `nock.disableNetConnect()` + endpoint stubs; the `registry-*.test.mts`
suites are canonical.

## Fires when

- Tool is `Write` or `Edit`.
- Target path is a test file (`*.test.*` / `*.spec.*`, or under `test/` /
  `__tests__/`).
- Post-edit content calls `httpJson` / `httpText` / `httpRequest` / `fetch` /
  `.request(`.
- The content has no `nock` reference.
- At least one network target is a non-localhost host (localhost-only is
  allowed).

## Bypass

Type `Allow unmocked-network-in-tests bypass` verbatim in a recent message.

## Why

2026-05-27, socket-packageurl-js: `purlExists` conda/docker dispatch tests hit
live `api.anaconda.org` / `hub.docker.com`, timing out at 15s. Full rationale:
`docs/agents.md/fleet/no-live-network-in-tests.md`.

Defense in depth with the fleet `test/scripts/fleet/setup.mts` (runtime `disableNetConnect()`)
and the CLAUDE.md rule.
