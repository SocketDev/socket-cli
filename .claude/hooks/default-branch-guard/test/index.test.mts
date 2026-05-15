import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(userText?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'defbranch-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: userText ?? 'do it' }),
  )
  return transcriptPath
}

function runHook(
  command: string,
  transcriptPath?: string,
  extraEnv: Record<string, string> = {},
): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      transcript_path: transcriptPath,
    }),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('BLOCKS BASE=main literal assignment', () => {
  const { stderr, exitCode } = runHook('BASE=main && git diff $BASE..HEAD')
  assert.equal(exitCode, 2)
  assert.match(stderr, /default-branch-guard/)
  assert.match(stderr, /BASE=main/)
})

test('BLOCKS BASE=master literal assignment', () => {
  const { exitCode } = runHook('BASE=master\ngit diff $BASE..HEAD')
  assert.equal(exitCode, 2)
})

test('BLOCKS --base main flag in gh pr create-like script', () => {
  const { exitCode } = runHook('gh pr create --base main --title foo')
  assert.equal(exitCode, 2)
})

test('BLOCKS --base=main', () => {
  const { exitCode } = runHook('gh pr create --base=main --title foo')
  assert.equal(exitCode, 2)
})

test('BLOCKS DEFAULT_BRANCH=main', () => {
  const { exitCode } = runHook('DEFAULT_BRANCH=main\ngit diff $DEFAULT_BRANCH..HEAD')
  assert.equal(exitCode, 2)
})

test('BLOCKS script-file write with main..HEAD literal', () => {
  const { exitCode } = runHook(
    'cat > script.sh <<EOF\ngit log main..HEAD\nEOF',
  )
  assert.equal(exitCode, 2)
})

test('ALLOWS plain interactive git checkout main', () => {
  const { exitCode } = runHook('git checkout main')
  assert.equal(exitCode, 0)
})

test('ALLOWS plain git pull origin main', () => {
  const { exitCode } = runHook('git pull origin main')
  assert.equal(exitCode, 0)
})

test('ALLOWS the canonical lookup pattern', () => {
  const { exitCode } = runHook(
    'BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed s@^refs/remotes/origin/@@)',
  )
  assert.equal(exitCode, 0)
})

test('IGNORES non-Bash tools', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: { command: 'BASE=main' },
    }),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
})

test('ALLOWS with "Allow default-branch bypass" phrase', () => {
  const t = makeTranscript('Allow default-branch bypass')
  const { exitCode } = runHook('BASE=main && git diff $BASE..HEAD', t)
  assert.equal(exitCode, 0)
})

test('disabled env var short-circuits', () => {
  const { exitCode } = runHook(
    'BASE=main',
    undefined,
    { SOCKET_DEFAULT_BRANCH_GUARD_DISABLED: '1' },
  )
  assert.equal(exitCode, 0)
})
