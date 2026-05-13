/**
 * @fileoverview Unit tests for no-external-issue-ref-guard.
 *
 * Test strategy: spawn the hook with a JSON payload on stdin and
 * assert the exit code + stderr. Mirrors the test shape used by the
 * no-revert-guard / no-meta-comments-guard test suites.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  code: number
  stderr: string
}

function runHook(payload: object): RunResult {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })
  return {
    code: typeof r.status === 'number' ? r.status : 0,
    stderr: r.stderr || '',
  }
}

function commit(command: string, transcriptPath?: string): RunResult {
  const payload: Record<string, unknown> = {
    tool_name: 'Bash',
    tool_input: { command },
  }
  if (transcriptPath) {
    payload['transcript_path'] = transcriptPath
  }
  return runHook(payload)
}

describe('no-external-issue-ref-guard', () => {
  test('allows non-Bash tools', () => {
    const r = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: '/tmp/foo.ts' },
    })
    assert.equal(r.code, 0)
  })

  test('allows git commit with no external refs', () => {
    const r = commit('git commit -m "fix(foo): bug in bar"')
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '')
  })

  test('allows bare #123 (same-repo, no cross-repo leak)', () => {
    const r = commit('git commit -m "fix(foo): close #123"')
    assert.equal(r.code, 0)
  })

  test('allows SocketDev/<repo>#<num>', () => {
    const r = commit(
      'git commit -m "chore: cascade SocketDev/socket-wheelhouse#42"',
    )
    assert.equal(r.code, 0)
  })

  test('allows SocketDev URL', () => {
    const r = commit(
      'git commit -m "fix: see https://github.com/SocketDev/socket-cli/issues/9"',
    )
    assert.equal(r.code, 0)
  })

  test('allows socketdev (lowercase) URL — case-insensitive', () => {
    const r = commit(
      'git commit -m "see https://github.com/socketdev/socket-lib/pull/100"',
    )
    assert.equal(r.code, 0)
  })

  test('blocks external owner/repo#num token in -m', () => {
    const r = commit(
      'git commit -m "chore(deps): trustPolicyExclude spencermountain/compromise#1203"',
    )
    assert.equal(r.code, 2)
    assert.match(r.stderr, /no-external-issue-ref-guard/)
    assert.match(r.stderr, /spencermountain\/compromise#1203/)
  })

  test('blocks external GitHub issue URL', () => {
    const r = commit(
      'git commit -m "see https://github.com/spencermountain/compromise/issues/1203"',
    )
    assert.equal(r.code, 2)
    assert.match(r.stderr, /spencermountain\/compromise\/issues\/1203/)
  })

  test('blocks external GitHub pull URL', () => {
    const r = commit(
      'git commit -m "fixes https://github.com/foo/bar/pull/7"',
    )
    assert.equal(r.code, 2)
  })

  test('blocks ref inside HEREDOC body', () => {
    const cmd = `git commit -m "$(cat <<'EOF'
chore(deps): trustPolicyExclude compromise@14.15.0

Maintainer issue: spencermountain/compromise#1203.
EOF
)"`
    const r = commit(cmd)
    assert.equal(r.code, 2)
    assert.match(r.stderr, /spencermountain\/compromise#1203/)
  })

  test('blocks ref in gh pr create --body', () => {
    const r = commit(
      'gh pr create --title "x" --body "fixes spencermountain/compromise#1203"',
    )
    assert.equal(r.code, 2)
  })

  test('blocks ref in gh issue comment --body', () => {
    const r = commit(
      'gh issue comment 1 --body "see torvalds/linux#999 too"',
    )
    assert.equal(r.code, 2)
    assert.match(r.stderr, /torvalds\/linux#999/)
  })

  test('does not trigger on non-message commands', () => {
    // `git push` doesn't have a message arg, even if "spencermountain
    // /compromise#1203" appeared somewhere in env vars or output.
    const r = commit('git push origin main')
    assert.equal(r.code, 0)
  })

  test('does not block when message text only has a SocketDev ref', () => {
    const r = commit(
      'git commit -m "chore: pick up SocketDev/socket-lib#42 fix"',
    )
    assert.equal(r.code, 0)
  })

  test('deduplicates repeated refs in stderr', () => {
    const r = commit(
      'git commit -m "spencermountain/compromise#1203 ' +
        'and again spencermountain/compromise#1203"',
    )
    assert.equal(r.code, 2)
    const matches = r.stderr.match(/spencermountain\/compromise#1203/g) || []
    // Ref appears in 'Refs found:' bullet — one bullet, not two.
    // (May also appear in narrative text once.)
    assert.ok(matches.length <= 2, `expected dedup; saw ${matches.length}`)
  })

  test('fails open on invalid JSON', () => {
    const r = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' })
    assert.equal(r.status, 0)
  })

  test('fails open on empty stdin', () => {
    const r = spawnSync('node', [HOOK], { input: '', encoding: 'utf8' })
    assert.equal(r.status, 0)
  })
})
