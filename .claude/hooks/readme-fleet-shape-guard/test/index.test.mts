// node --test specs for the readme-fleet-shape-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  // v6 lib-stable spawn returns an enriched Promise that rejects on
  // non-zero exit; this test reads stderr + exit via manual listeners
  // instead. Swallow the Promise rejection so it doesn't race the
  // listener-based resolve and trigger "async activity after test ended".
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

const CANONICAL_README = [
  '# foo',
  '',
  '## Why this repo exists',
  '',
  'A thing.',
  '',
  '## Install',
  '',
  '```sh',
  'npm install foo',
  '```',
  '',
  '## Usage',
  '',
  '```js',
  'const foo = require("foo")',
  '```',
  '',
  '## Development',
  '',
  'pnpm install',
  '',
  '## License',
  '',
  'MIT',
  '',
].join('\n')

test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('nested README is ignored', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/packages/bar/README.md',
      content: '# bar\n\nNo canonical sections at all.\n',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('canonical root README passes', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/README.md',
      content: CANONICAL_README,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('missing canonical section is blocked', async () => {
  const broken = CANONICAL_README.replace('## Install', '## Setup')
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/README.md',
      content: broken,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /readme-fleet-shape-guard/)
  assert.match(result.stderr, /Missing canonical section "## Install"/)
})

test('socket-wheelhouse mention is blocked', async () => {
  const leaky = CANONICAL_README.replace(
    'A thing.',
    'A thing. See socket-wheelhouse for details.',
  )
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/README.md',
      content: leaky,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /socket-wheelhouse/)
})

test('relative sibling script is blocked', async () => {
  const sibling = CANONICAL_README.replace(
    'pnpm install',
    'node ../socket-bar/scripts/foo.mts',
  )
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/README.md',
      content: sibling,
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /sibling-relative path/)
})
