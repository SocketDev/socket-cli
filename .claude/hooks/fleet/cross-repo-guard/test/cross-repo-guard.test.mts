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

test('blocks ../socket-lib/ relative reference', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/<user>/projects/ultrathink/assets/x.mjs',
      content: `const f = require('../../socket-lib/dist/effects/x.js')`,
    },
  })
  assert.equal(code, 2, `expected exit 2; got ${code}; stderr=${stderr}`)
  assert.ok(stderr.includes('cross-repo-guard'))
})

test('blocks /Users/<user>/projects/<fleet-repo>/ absolute reference', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/<user>/projects/ultrathink/assets/x.mjs',
      content: `const f = require('/Users/<user>/projects/socket-lib/dist/effects/x.js')`,
    },
  })
  assert.equal(code, 2, `expected exit 2; got ${code}; stderr=${stderr}`)
  assert.ok(stderr.includes('/projects/socket-lib'))
})

test('does not block @socketsecurity/lib-stable package import', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: `import { applyShimmer } from '@socketsecurity/lib-stable/effects/shimmer'`,
    },
  })
  assert.equal(code, 0)
})

test('does not block own-repo paths (socket-lib editing socket-lib paths)', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/<user>/projects/socket-lib/scripts/foo.mts',
      content: `// path: /Users/<user>/projects/socket-lib/dist/effects/x.js`,
    },
  })
  assert.equal(code, 0)
})

test('respects // socket-lint: allow cross-repo marker', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: `const p = '../../socket-cli/x' // socket-lint: allow cross-repo`,
    },
  })
  assert.equal(code, 0)
})

test('respects bare // socket-lint: allow marker', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: `const p = '../../socket-cli/x' // socket-lint: allow`,
    },
  })
  assert.equal(code, 0)
})

test('skips files outside scope (CLAUDE.md, .gitmodules)', async () => {
  for (const filePath of [
    'CLAUDE.md',
    '.gitmodules',
    '.git-hooks/_helpers.mts',
    'pnpm-lock.yaml',
  ]) {
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: filePath,
        content: `mention of ../../socket-lib/ here`,
      },
    })
    assert.equal(code, 0, `unexpected block on ${filePath}`)
  }
})

test('does not fire on non-Edit/Write tools', async () => {
  const { code } = await runHook({
    tool_name: 'Bash',
    tool_input: { content: '' },
  })
  assert.equal(code, 0)
})
