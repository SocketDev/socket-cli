#!/usr/bin/env node
// Claude Code PreToolUse hook — no-unmocked-net-guard.
//
// Blocks Write/Edit operations on a test file that performs HTTP against a
// third-party host without mocking it via `nock`. Live network in tests is
// flaky, slow, and a data-exfil surface; the fleet pattern is
// `nock.disableNetConnect()` + endpoint stubs (see the `registry-*.test.mts`
// suites and `docs/agents.md/fleet/no-live-network-in-tests.md`).
//
// Detection model:
//   - Fires only on Write/Edit whose target path looks like a test file
//     (`*.test.*` or under a `test/` or `__tests__/` directory).
//   - Looks at the post-edit file content (`content` for Write, `new_string`
//     for Edit).
//   - Flags a network call: `httpJson(`, `httpText(`, `httpRequest(`,
//     `fetch(`, or `.request(` — the fleet HTTP surface plus raw fetch.
//   - If the content references `nock` (the file mocks the network), allow.
//   - If every network call targets localhost / 127.0.0.1 (a fixture server),
//     allow.
//   - Otherwise block.
//
// Bypass: `Allow unmocked-network-in-tests bypass` typed verbatim in a recent
// user turn.
//
// Fails open on parse errors or non-test files — under-blocking beats blocking
// on infrastructure problems.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

// A path is a test file if its basename matches `*.test.*` / `*.spec.*` or it
// lives under a `test/` or `__tests__/` directory.
export function isTestFilePath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)) {
    return true
  }
  return /(?:^|\/)(?:test|tests|__tests__)\//.test(normalized)
}

// Network-call surfaces flagged in test bodies: the fleet HTTP helpers and raw
// fetch / `.request(`.
const NETWORK_CALL_RE =
  /\b(?:httpJson|httpText|httpRequest|fetch)\s*\(|\.request\s*\(/

export function hasNetworkCall(text: string): boolean {
  return NETWORK_CALL_RE.test(text)
}

export function referencesNock(text: string): boolean {
  return /\bnock\b/.test(text)
}

// True when every literal URL/host in the text is localhost. If there are no
// literal hosts at all we can't prove it's localhost-only, so return false.
export function onlyLocalhostHosts(text: string): boolean {
  const urls = text.match(/https?:\/\/[^\s'"`)]+/g)
  if (!urls || urls.length === 0) {
    return false
  }
  return urls.every(u =>
    // Host is exactly 127.0.0.1 or localhost, immediately followed by a port
    // colon, a path slash, or end of string — no other hosts.
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/.test(u),
  )
}

export function shouldBlock(filePath: string, content: string): boolean {
  if (!isTestFilePath(filePath)) {
    return false
  }
  if (!hasNetworkCall(content)) {
    return false
  }
  if (referencesNock(content)) {
    return false
  }
  if (onlyLocalhostHosts(content)) {
    return false
  }
  return true
}

// editGuard handles the stdin drain, tool_name gate, file_path narrow, content
// extraction, and fail-open on any throw.
export const check = editGuard((filePath, content) => {
  if (!shouldBlock(filePath, content ?? '')) {
    return undefined
  }

  return block(
    [
      '[no-unmocked-net-guard] Blocked: test makes a live third-party connection',
      '',
      `  File: ${filePath}`,
      '',
      '  This test calls httpJson/httpText/httpRequest/fetch against a',
      '  non-localhost host with no `nock` mock in the file. Live network in',
      '  tests is flaky, slow, and a data-exfil surface.',
      '',
      '  Fix: mock the endpoint with nock, like the registry-*.test.mts suites:',
      "    import nock from 'nock'",
      '    beforeEach(() => nock.disableNetConnect())',
      '    afterEach(() => { nock.cleanAll(); nock.enableNetConnect() })',
      "    nock('https://host').get('/path').reply(200, { ... })",
      '',
      '  Detail: docs/agents.md/fleet/no-live-network-in-tests.md',
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['unmocked-network-in-tests'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
