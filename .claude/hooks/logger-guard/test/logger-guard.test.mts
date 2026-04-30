import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

interface Payload {
  tool_name: 'Edit' | 'Write' | string
  tool_input: {
    file_path?: string
    new_string?: string
    content?: string
  }
}

function runHook(payload: Payload): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', d => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

test('blocks console.log in src/ .ts files', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: 'export function foo() { console.log("hi") }',
    },
  })
  assert.equal(code, 2, `expected exit 2; got ${code}; stderr=${stderr}`)
  assert.ok(stderr.includes('logger-guard'))
  assert.ok(stderr.includes('Fix:'))
  assert.ok(stderr.includes('logger.info'))
})

test('blocks process.stderr.write in src/ .mts files', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/utils/output.mts',
      new_string: 'process.stderr.write("oops\\n")',
    },
  })
  assert.equal(code, 2)
  assert.ok(stderr.includes('logger.error('))
})

test('allows hooks themselves to use process.stderr.write', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '.claude/hooks/some-hook/index.mts',
      new_string: 'process.stderr.write("ok\\n")',
    },
  })
  assert.equal(code, 0, `expected exit 0; got ${code}; stderr=${stderr}`)
})

test('allows scripts/ to use console.log', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'scripts/build.mts',
      new_string: 'console.log("build complete")',
    },
  })
  assert.equal(code, 0)
})

test('allows tests to use console.log', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/utils/foo.test.mts',
      new_string: 'console.log("debug")',
    },
  })
  assert.equal(code, 0)
})

test('respects # socket-hook: allow logger marker', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/foo.ts',
      new_string:
        'const x = 1; console.error("legacy") // # socket-hook: allow logger',
    },
  })
  assert.equal(code, 0)
})

test('respects bare # socket-hook: allow marker', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/foo.ts',
      new_string: 'console.warn("a") // # socket-hook: allow',
    },
  })
  assert.equal(code, 0)
})

test('does not flag JSDoc examples', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content:
        '/**\n * @example\n * console.log("usage")\n */\nexport const foo = 1',
    },
  })
  assert.equal(code, 0)
})

test('does not flag comment lines', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/foo.ts',
      new_string: '// previously: console.log("debug")',
    },
  })
  assert.equal(code, 0)
})

test('does not flag content fully inside a single backtick span', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/foo.ts',
      // Single-line markdown-style backtick span — the inner content
      // is documentation, not real code.
      new_string: 'const note = `use logger.info() not console.log()`',
    },
  })
  assert.equal(code, 0)
})

test('does not run on non-Edit/Write tools', async () => {
  const { code } = await runHook({
    tool_name: 'Bash',
    tool_input: { content: 'console.log("nope")' },
  })
  assert.equal(code, 0)
})

test('does not run on .js files (out of scope)', async () => {
  const { code } = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'src/foo.js',
      new_string: 'console.log("legacy")',
    },
  })
  assert.equal(code, 0)
})
