// node --test specs for the brew-supply-chain-guard hook.
//
// The hook's verdict depends on the real machine's `brew --version`, which the
// test can't control. So these specs exercise the parts that ARE deterministic:
// non-brew commands pass; a brew command on a machine WITHOUT brew passes
// (`absent`); the bypass phrase short-circuits; malformed input fails open. The
// pure detection (version floor, env knobs) is unit-tested against the shared
// lib in _shared, not here.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — the test spawns the hook as a
// child and pipes stdin/stdout/stderr; Node spawn returns the ChildProcess
// streaming surface the lib promise wrapper does not expose.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(
  payload: Record<string, unknown>,
  env?: NodeJS.ProcessEnv,
): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], {
    stdio: 'pipe',
    env: { ...process.env, ...env },
  })
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify(payload))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

// True when `brew` resolves on this machine — gates the brew-present assertions.
async function brewPresent(): Promise<boolean> {
  const child = spawn('which', ['brew'], { stdio: 'pipe' })
  void child.catch(() => undefined)
  return new Promise(resolve => {
    child.process.on('exit', code => resolve(code === 0))
  })
}

test('non-Bash tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { file_path: '/x/CLAUDE.md', content: 'brew install gh' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('a Bash command that does not invoke brew passes through', async () => {
  const result = await runHook({
    tool_input: { command: 'echo brew && ls -la' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('empty command passes through', async () => {
  const result = await runHook({
    tool_input: { command: '   ' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('brew invocation on a machine without brew passes (absent, not applicable)', async () => {
  if (await brewPresent()) {
    // brew is installed here; skip — this case asserts the `absent` path.
    return
  }
  const result = await runHook({
    tool_input: { command: 'brew install gh' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('blocks a brew invocation when brew is present but unhardened', async () => {
  // This asserts the block path only when the machine actually has an
  // unhardened brew (present, but <6.0.0 OR a knob unset). With the env knobs
  // forced OFF, any brew <6.0.0 (or any brew with the knobs unset) is
  // unhardened. A hardened machine (brew>=6.0.0 + both knobs) would pass — skip
  // there, since we can't downgrade brew in a test.
  if (!(await brewPresent())) {
    return
  }
  const result = await runHook(
    {
      tool_input: { command: 'brew install gh' },
      tool_name: 'Bash',
    },
    {
      HOMEBREW_REQUIRE_TAP_TRUST: '',
      HOMEBREW_CASK_OPTS_REQUIRE_SHA: '',
    },
  )
  // Knobs forced empty → at minimum the env check fails → unhardened → block.
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /brew-supply-chain-guard/)
  assert.match(result.stderr, /Bypass/)
})

test('fails open on malformed stdin', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('not valid json')
  const code: number = await new Promise(resolve => {
    child.process.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
})

test('fails open on empty stdin', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('')
  const code: number = await new Promise(resolve => {
    child.process.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
})
