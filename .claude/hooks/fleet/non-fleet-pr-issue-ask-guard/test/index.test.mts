import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function runHook(payload: object): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })
  return { stderr: result.stderr ?? '', exitCode: result.status ?? -1 }
}

test('BLOCKS gh pr create --repo against non-fleet repo', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'gh pr create --repo oxc-project/oxc --title "x" --body "y"',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /non-fleet-pr-issue-ask-guard: blocked/)
  assert.match(stderr, /oxc-project\/oxc/)
  assert.match(stderr, /gh pr create/)
})

test('BLOCKS gh issue create --repo against non-fleet repo', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'gh issue create --repo nodejs/node --title "x" --body "y"',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /nodejs\/node/)
  assert.match(stderr, /gh issue create/)
})

test('BLOCKS gh release create --repo against non-fleet repo', () => {
  const { exitCode } = runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'gh release create v1.0 --repo example/repo',
    },
  })
  assert.equal(exitCode, 2)
})

test('ALLOWS gh pr create --repo against fleet repo (SocketDev/socket-lib)', () => {
  const { exitCode } = runHook({
    tool_name: 'Bash',
    tool_input: {
      command:
        'gh pr create --repo SocketDev/socket-lib --title "x" --body "y"',
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS gh pr create --repo against fleet repo (SocketDev/socket-wheelhouse)', () => {
  const { exitCode } = runHook({
    tool_name: 'Bash',
    tool_input: {
      command:
        'gh pr create --repo SocketDev/socket-wheelhouse --title "x" --body "y"',
    },
  })
  assert.equal(exitCode, 0)
})

test('IGNORES non-public gh subcommands (gh pr view, gh issue list)', () => {
  const { exitCode: prView } = runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh pr view --repo oxc-project/oxc 12345' },
  })
  assert.equal(prView, 0)

  const { exitCode: issueList } = runHook({
    tool_name: 'Bash',
    tool_input: { command: 'gh issue list --repo oxc-project/oxc' },
  })
  assert.equal(issueList, 0)
})

test('IGNORES non-Bash tools', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/x.txt',
      new_string: 'gh pr create --repo oxc-project/oxc',
    },
  })
  assert.equal(exitCode, 0)
})

test('IGNORES commands without gh', () => {
  const { exitCode } = runHook({
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
  })
  assert.equal(exitCode, 0)
})
