// prefer-async-spawn: streaming-stdio-required — spawns the hook subprocess and
// pipes a Bash payload on stdin, asserting on exit (2 = block, 0 = pass).
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

function runHook(command: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    void child.catch(() => undefined)
    let stderr = ''
    child.process.stderr!.on('data', d => {
      stderr += d.toString()
    })
    child.process.on('error', reject)
    child.process.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    child.stdin!.end(
      JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    )
  })
}

test('blocks bare oxlint', async () => {
  const { code, stderr } = await runHook('oxlint -c .config/fleet/oxlintrc.json src')
  assert.equal(code, 2, `expected block; stderr=${stderr}`)
  assert.ok(stderr.includes('no-direct-linter-guard'))
})

test('blocks bare oxfmt even with a config flag', async () => {
  const { code } = await runHook(
    'oxfmt -c .config/fleet/oxfmtrc.json --write src/index.ts',
  )
  assert.equal(code, 2)
})

test('blocks node_modules/.bin/oxlint', async () => {
  const { code } = await runHook('node_modules/.bin/oxlint src')
  assert.equal(code, 2)
})

test('blocks eslint / prettier / biome / dprint', async () => {
  for (const cmd of [
    'eslint .',
    'prettier --write .',
    'biome format --write .',
    'dprint fmt',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook(cmd)
    assert.equal(code, 2, `expected block for: ${cmd}`)
  }
})

test('blocks cargo fmt and cargo clippy (subcommand form)', async () => {
  for (const cmd of ['cargo fmt', 'cargo fmt --all', 'cargo clippy --fix']) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook(cmd)
    assert.equal(code, 2, `expected block for: ${cmd}`)
  }
})

test('blocks rustfmt and gofmt', async () => {
  for (const cmd of ['rustfmt src/lib.rs', 'gofmt -w .']) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook(cmd)
    assert.equal(code, 2, `expected block for: ${cmd}`)
  }
})

test('allows pnpm run lint / fix / check / format (the wrappers)', async () => {
  for (const cmd of [
    'pnpm run lint',
    'pnpm run fix --all',
    'pnpm run check --all',
    'pnpm run format',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code, stderr } = await runHook(cmd)
    assert.equal(code, 0, `expected pass for: ${cmd}; stderr=${stderr}`)
  }
})

test('allows a scripts/fleet/* wrapper invocation', async () => {
  const { code } = await runHook('node scripts/fleet/check/only-oxlint-oxfmt.mts')
  assert.equal(code, 0)
})

test('allows cargo build / cargo test (non-format subcommands)', async () => {
  for (const cmd of ['cargo build --release', 'cargo test']) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook(cmd)
    assert.equal(code, 0, `expected pass for: ${cmd}`)
  }
})

test('non-Bash tool passes', async () => {
  const child = spawn(process.execPath, [HOOK], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  void child.catch(() => undefined)
  const code = await new Promise<number>(resolve => {
    child.process.on('exit', c => resolve(c ?? -1))
    child.stdin!.end(
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'x' } }),
    )
  })
  assert.equal(code, 0)
})

test('malformed payload fails open (exit 0)', async () => {
  const child = spawn(process.execPath, [HOOK], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  void child.catch(() => undefined)
  const code = await new Promise<number>(resolve => {
    child.process.on('exit', c => resolve(c ?? -1))
    child.stdin!.end('{ not json')
  })
  assert.equal(code, 0)
})
