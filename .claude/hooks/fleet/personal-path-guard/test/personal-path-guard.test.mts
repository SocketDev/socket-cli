// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

interface Payload {
  tool_name: 'Edit' | 'Write' | string
  tool_input: {
    file_path?: string | undefined
    new_string?: string | undefined
    content?: string | undefined
  }
}

function runHook(payload: Payload): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    // v6 lib-stable spawn returns an enriched Promise that rejects on
    // non-zero exit; this test reads stderr + exit via manual listeners
    // instead. Swallow the Promise rejection so it doesn't race the
    // listener-based resolve and trigger "async activity after test ended".
    void child.catch(() => undefined)
    let stderr = ''
    child.process.stderr!.on('data', d => {
      stderr += d.toString()
    })
    child.process.on('error', reject)
    child.process.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    child.stdin!.end(JSON.stringify(payload))
  })
}

test('blocks a hardcoded /Users/<name>/ path in a Write', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: 'const home = "/Users/jdalton/projects/x"',
    },
  })
  assert.equal(code, 2, `expected exit 2; got ${code}; stderr=${stderr}`)
  assert.ok(stderr.includes('personal-path-guard'))
  assert.ok(stderr.includes('/Users/<user>/'))
})

test('blocks a hardcoded /home/<name>/ path in an Edit', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'scripts/run.mts',
      new_string: 'const p = "/home/alice/.config/app"',
    },
  })
  assert.equal(code, 2)
})

test('blocks a hardcoded C:\\Users\\<name>\\ path', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'docs/setup.md',
      content: 'cd C:\\Users\\bob\\projects',
    },
  })
  assert.equal(code, 2)
})

test('allows ~/ home-relative paths', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: 'const p = "~/.config/gh/hosts.yml"',
    },
  })
  assert.equal(code, 0)
})

test('allows $HOME / ${USER} env-var paths', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/foo.ts',
      new_string: 'const p = `/Users/${USER}/projects`',
    },
  })
  assert.equal(code, 0)
})

test('allows the canonical <user> placeholder', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'docs/setup.md',
      content: 'Example: /Users/<user>/projects/socket-mcp',
    },
  })
  assert.equal(code, 0)
})

test('respects // socket-lint: allow personal-path marker', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/foo.ts',
      new_string: 'const p = "/Users/jdalton/x" // socket-lint: allow personal-path',
    },
  })
  assert.equal(code, 0)
})

test('respects bare // socket-lint: allow marker', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/foo.ts',
      new_string: 'const p = "/Users/jdalton/x" // socket-lint: allow',
    },
  })
  assert.equal(code, 0)
})

test('does not flag node_modules content (out of scope)', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'node_modules/pkg/cache.json',
      content: '{"path":"/Users/jdalton/x"}',
    },
  })
  assert.equal(code, 0)
})

test('does not flag lockfile content (out of scope)', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'pnpm-lock.yaml',
      content: 'resolution: /Users/jdalton/.pnpm-store/x',
    },
  })
  assert.equal(code, 0)
})

test('catches NFKC full-width /Users variant', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: 'const p = "／Users／jdalton／x"',
    },
  })
  assert.equal(code, 2)
})

test('does not run on non-Edit/Write tools', async () => {
  const { code } = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo /Users/jdalton/x' },
  })
  assert.equal(code, 0)
})
