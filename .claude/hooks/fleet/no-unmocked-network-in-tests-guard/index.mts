#!/usr/bin/env node
// Claude Code PreToolUse hook — no-unmocked-network-in-tests-guard.
//
// Blocks Write/Edit operations on a test file that performs HTTP against a
// third-party host without mocking it via `nock`. Live network in tests is
// flaky, slow, and a data-exfil surface; the fleet pattern is
// `nock.disableNetConnect()` + endpoint stubs (see the `registry-*.test.mts`
// suites and `docs/claude.md/fleet/no-live-network-in-tests.md`).
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

import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow unmocked-network-in-tests bypass'

interface ToolInput {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
        readonly content?: string | undefined
      }
    | undefined
  readonly transcript_path?: string | undefined
}

// A path is a test file if its basename matches `*.test.*` / `*.spec.*` or it
// lives under a `test/` or `__tests__/` directory.
export function isTestFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
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

async function main(): Promise<void> {
  const raw = await readStdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }

  const toolName = payload.tool_name
  if (toolName !== 'Edit' && toolName !== 'Write') {
    return
  }

  const filePath = payload.tool_input?.file_path
  if (!filePath) {
    return
  }

  const content =
    payload.tool_input?.content ?? payload.tool_input?.new_string ?? ''
  if (!shouldBlock(filePath, content)) {
    return
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    process.exit(0)
  }

  process.stderr.write(
    [
      '[no-unmocked-network-in-tests-guard] Blocked: test makes a live third-party connection',
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
      '  Detail: docs/claude.md/fleet/no-live-network-in-tests.md',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exit(2)
}

main().catch(e => {
  process.stderr.write(
    `[no-unmocked-network-in-tests-guard] hook error (allowing): ${(e as Error).message}\n`,
  )
})
