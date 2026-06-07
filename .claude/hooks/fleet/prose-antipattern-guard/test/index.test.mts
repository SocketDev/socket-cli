// node --test specs for the prose-antipattern-guard PreToolUse hook.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PROSE_PATTERNS,
  findChangelogImplDetail,
  findProseAntipatterns,
} from '../patterns.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscriptWithBypass(phrase: string): {
  path: string
  cleanup: () => void
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'prose-guard-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: phrase }),
  )
  return {
    path: transcriptPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function runGuard(
  toolInput: { file_path: string; content?: string; new_string?: string },
  opts?: {
    toolName?: string
    transcriptPath?: string
    env?: NodeJS.ProcessEnv
  },
): { stderr: string; exitCode: number } {
  const payload: Record<string, unknown> = {
    tool_name: opts?.toolName ?? 'Write',
    tool_input: toolInput,
  }
  if (opts?.transcriptPath) {
    payload['transcript_path'] = opts.transcriptPath
  }
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    ...(opts?.env ? { env: opts.env } : {}),
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

const DIRTY = 'This is basically a thin wrapper.'
const CLEAN = 'The cache stores parsed results keyed by input path.'

test('blocks a CHANGELOG.md write carrying an antipattern', () => {
  const { stderr, exitCode } = runGuard({
    file_path: '/p/socket-lib/CHANGELOG.md',
    content: DIRTY,
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /prose-antipattern-guard/)
  assert.match(stderr, /hedging adverb/)
})

test('blocks a docs/**/*.md write carrying an antipattern', () => {
  const { exitCode } = runGuard({
    file_path: '/p/socket-lib/docs/claude.md/fleet/foo.md',
    content: "Here's the thing about caching.",
  })
  assert.equal(exitCode, 2)
})

test('blocks a README.md write carrying an antipattern', () => {
  const { exitCode } = runGuard({
    file_path: '/p/socket-lib/README.md',
    content: "It's not fast, it's the network.",
  })
  assert.equal(exitCode, 2)
})

test('allows clean prose on a prose surface', () => {
  const { stderr, exitCode } = runGuard({
    file_path: '/p/socket-lib/CHANGELOG.md',
    content: CLEAN,
  })
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('ignores a non-prose file even with antipatterns', () => {
  const { exitCode } = runGuard({
    file_path: '/p/socket-lib/src/cache.ts',
    content: DIRTY,
  })
  assert.equal(exitCode, 0)
})

test('the bypass phrase lets the write through', () => {
  const { path: p, cleanup } = makeTranscriptWithBypass(
    'Allow prose-antipattern bypass',
  )
  try {
    const { exitCode } = runGuard(
      { file_path: '/p/socket-lib/CHANGELOG.md', content: DIRTY },
      { transcriptPath: p },
    )
    assert.equal(exitCode, 0)
  } finally {
    cleanup()
  }
})

test('reads new_string for Edit payloads', () => {
  const { exitCode } = runGuard(
    { file_path: '/p/socket-lib/CHANGELOG.md', new_string: DIRTY },
    { toolName: 'Edit' },
  )
  assert.equal(exitCode, 2)
})

test('findProseAntipatterns returns matches, empty when clean', () => {
  assert.equal(findProseAntipatterns(CLEAN).length, 0)
  assert.ok(
    findProseAntipatterns(DIRTY).some(p => p.label === 'hedging adverb'),
  )
})

test('exported patterns match their target shapes', () => {
  const byLabel = new Map(PROSE_PATTERNS.map(p => [p.label, p.regex]))
  assert.equal(byLabel.size, 4)
  assert.match('a — b — c', byLabel.get('em-dash chain')!)
  assert.doesNotMatch('a — b', byLabel.get('em-dash chain')!)
  assert.match('Let me explain', byLabel.get('throat-clearing opener')!)
  assert.match("not fast, it's slow", byLabel.get('"not X, it\'s Y" contrast')!)
  assert.match('essentially done', byLabel.get('hedging adverb')!)
})

// ---------- CHANGELOG implementation-detail guard ----------

const CHANGELOG_IMPL_REJECTED =
  'Resolved by upgrading `@socketsecurity/lib` to 6.0.7, which decodes by Content-Encoding before parsing.'
const CHANGELOG_USER_FACING =
  'The `package_files` and `organizations` tools no longer fail with `Unexpected token` JSON errors against the live Socket API.'

test('blocks a CHANGELOG entry carrying implementation detail', () => {
  const { stderr, exitCode } = runGuard({
    file_path: '/p/socket-mcp/CHANGELOG.md',
    content: CHANGELOG_IMPL_REJECTED,
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /implementation detail/)
})

test('allows a user-facing CHANGELOG entry', () => {
  const { exitCode, stderr } = runGuard({
    file_path: '/p/socket-mcp/CHANGELOG.md',
    content: CHANGELOG_USER_FACING,
  })
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})

test('impl-detail check is CHANGELOG-scoped (not README/docs)', () => {
  // A dep mention in a README is fine — that surface documents install.
  const { exitCode } = runGuard({
    file_path: '/p/socket-mcp/README.md',
    content: 'Install with `pnpm add @socketsecurity/mcp`.',
  })
  assert.equal(exitCode, 0)
})

test('changelog-impl-detail bypass phrase lets it through', () => {
  const { path: tp, cleanup } = makeTranscriptWithBypass(
    'Allow changelog-impl-detail bypass',
  )
  try {
    const { exitCode } = runGuard(
      {
        file_path: '/p/socket-mcp/CHANGELOG.md',
        content: CHANGELOG_IMPL_REJECTED,
      },
      { transcriptPath: tp },
    )
    assert.equal(exitCode, 0)
  } finally {
    cleanup()
  }
})

test('findChangelogImplDetail flags dep/version/mechanism, clean otherwise', () => {
  assert.equal(findChangelogImplDetail(CHANGELOG_USER_FACING).length, 0)
  const hits = findChangelogImplDetail(CHANGELOG_IMPL_REJECTED).map(
    p => p.label,
  )
  assert.ok(hits.includes('dependency mention'))
  assert.ok(hits.includes('"resolved by" / mechanism tail'))
  assert.ok(hits.includes('internal mechanism token'))
})
