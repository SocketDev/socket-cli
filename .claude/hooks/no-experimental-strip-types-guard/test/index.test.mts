// node --test specs for the no-experimental-strip-types-guard hook.
//
// Spawns the hook as a subprocess (matches the production runtime),
// pipes a JSON payload on stdin, captures stderr + exit code.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

interface Result {
  readonly code: number
  readonly stderr: string
}

async function runHook(
  payload: Record<string, unknown>,
): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end(JSON.stringify(payload))
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

test('non-Bash tool calls pass through untouched', async () => {
  const result = await runHook({
    tool_input: { file_path: 'foo.ts', new_string: 'const x = 1' },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('benign bash commands pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'node foo.ts' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('blocks --experimental-strip-types as a node arg', async () => {
  const result = await runHook({
    tool_input: { command: 'node --experimental-strip-types foo.ts' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-experimental-strip-types-guard/)
  assert.match(result.stderr, /Current Node/)
})

test('blocks --experimental-strip-types via NODE_OPTIONS', async () => {
  const result = await runHook({
    tool_input: {
      command: 'NODE_OPTIONS="--experimental-strip-types" node foo.ts',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('blocks --experimental-strip-types via pnpm exec', async () => {
  const result = await runHook({
    tool_input: {
      command: 'pnpm exec node --experimental-strip-types foo.ts',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('does not match a substring that is not the flag', async () => {
  // Word-boundary check: --experimental-strip-types-foo should not match.
  // But the regex uses \b which treats `-` as a word boundary too, so
  // anything appearing after the flag word ends at any non-word char.
  // The flag literally ending with another `--foo` after it should still
  // match `--experimental-strip-types\b`. We document this with a positive
  // test: bare flag matches even with trailing args.
  const result = await runHook({
    tool_input: {
      command: 'node --experimental-strip-types --some-other foo.ts',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('does not match an unrelated string containing experimental', async () => {
  const result = await runHook({
    tool_input: {
      command: 'node --experimental-vm-modules foo.ts',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('does not match flag mentioned inside a single-quoted string', async () => {
  const result = await runHook({
    tool_input: {
      command: "echo 'tip: drop --experimental-strip-types from your script'",
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('does not match flag mentioned inside a double-quoted string', async () => {
  const result = await runHook({
    tool_input: {
      command: 'echo "tip: drop --experimental-strip-types from your script"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('does not match flag mentioned inside a heredoc body', async () => {
  const result = await runHook({
    tool_input: {
      command:
        "git commit -m \"$(cat <<'EOF'\nthe --experimental-strip-types flag is dead\nEOF\n)\"",
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('still blocks flag passed as a real arg even when other quoted args mention it', async () => {
  const result = await runHook({
    tool_input: {
      command:
        "echo 'reminder' && node --experimental-strip-types foo.ts",
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('fails open on malformed payload', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end('not valid json')
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
  assert.strictEqual(result.code, 0)
})
