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

test('blocks /Users/<name>/projects/<fleet-repo>/ absolute reference', async () => {
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

test('does not block @socketsecurity/lib package import', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: `import { applyShimmer } from '@socketsecurity/lib/effects/shimmer'`,
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

test('respects // socket-hook: allow cross-repo marker', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: `const p = '../../socket-cli/x' // socket-hook: allow cross-repo`,
    },
  })
  assert.equal(code, 0)
})

test('respects bare // socket-hook: allow marker', async () => {
  const { code } = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: 'src/foo.ts',
      content: `const p = '../../socket-cli/x' // socket-hook: allow`,
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
