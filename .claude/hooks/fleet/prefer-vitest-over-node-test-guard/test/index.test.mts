import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.mts')

function run(command: string, transcriptLines: string[] = []) {
  const transcript = transcriptLines
    .map(l => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: l }] } }))
    .join('\n')
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: undefined }),
    encoding: 'utf8',
  })
  return { code: r.status ?? -1, stderr: r.stderr }
}

test('blocks node --test <file>', () => {
  const { code, stderr } = run('node --test test/unit/foo.test.mts')
  assert.equal(code, 2)
  assert.match(stderr, /prefer-vitest-over-node-test-guard/)
  assert.match(stderr, /pnpm exec vitest run/)
  assert.match(stderr, /test\/unit\/foo\.test\.mts/)
})

test('blocks node --test (no file)', () => {
  const { code } = run('node --test')
  assert.equal(code, 2)
})

test('blocks node --require hook --test file', () => {
  const { code } = run('node --require ./setup.js --test test/foo.mts')
  assert.equal(code, 2)
})

test('allows node --run (pnpm script runner)', () => {
  const { code } = run('node --run test')
  assert.equal(code, 0)
})

test('allows pnpm exec vitest run', () => {
  const { code } = run('pnpm exec vitest run test/unit/foo.test.mts')
  assert.equal(code, 0)
})

test('allows pnpm test', () => {
  const { code } = run('pnpm test')
  assert.equal(code, 0)
})

test('non-Bash tool passes through', () => {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'foo.ts' } }),
    encoding: 'utf8',
  })
  assert.equal(r.status, 0)
})

test('malformed payload fails open', () => {
  const r = spawnSync('node', [HOOK], { input: 'not-json', encoding: 'utf8' })
  assert.equal(r.status, 0)
})
