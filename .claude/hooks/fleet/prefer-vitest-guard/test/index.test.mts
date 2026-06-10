import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'index.mts',
)

function run(command: string, transcriptLines: string[] = []) {
  const transcript = transcriptLines
    .map(l =>
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: l }] },
      }),
    )
    .join('\n')
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      transcript_path: undefined,
    }),
    encoding: 'utf8',
  })
  return { code: r.status ?? -1, stderr: r.stderr }
}

test('blocks node --test <file>', () => {
  const { code, stderr } = run('node --test test/unit/foo.test.mts')
  assert.equal(code, 2)
  assert.match(stderr, /prefer-vitest-guard/)
  assert.match(stderr, /node_modules\/\.bin\/vitest run/)
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

test('blocks node --test --import tsx <file>', () => {
  const { code, stderr } = run('node --test --import tsx test/foo.test.mts')
  assert.equal(code, 2)
  assert.match(stderr, /node_modules\/\.bin\/vitest run/)
})

test('blocks bare tsx running a test file', () => {
  const { code, stderr } = run('tsx test/unit/foo.test.mts')
  assert.equal(code, 2)
  assert.match(stderr, /vitest/)
})

test('blocks ts-node running a spec file', () => {
  const { code } = run('ts-node src/foo.spec.ts')
  assert.equal(code, 2)
})

test('allows tsx running a non-test script', () => {
  const { code } = run('tsx scripts/build.mts')
  assert.equal(code, 0)
})

test('allows node --run (pnpm script runner)', () => {
  const { code } = run('node --run test')
  assert.equal(code, 0)
})

test('allows node --test for a hook test (canonical cwd-relative glob)', () => {
  // The form scripts/repo/run-hook-tests.mts uses, cwd = the hook dir.
  const { code } = run('node --test test/*.test.mts')
  assert.equal(code, 0)
})

test('allows node --test for a hook test (full .claude/hooks path)', () => {
  const { code } = run(
    'node --test .claude/hooks/fleet/some-guard/test/index.test.mts',
  )
  assert.equal(code, 0)
})

test('allows node --test for an oxlint-plugin rule test', () => {
  // .config/fleet/oxlint-plugin/test/** is vitest-excluded → node --test tier.
  const { code } = run(
    'node --test .config/fleet/oxlint-plugin/test/max-file-lines.test.mts',
  )
  assert.equal(code, 0)
})

test('allows node --test for an oxlint-plugin test glob', () => {
  const { code } = run(
    'node --test .config/fleet/oxlint-plugin/test/*.test.mts',
  )
  assert.equal(code, 0)
})

test('blocks node --test mixing a hook test with a src test', () => {
  // Not every target is node-test-tier → still a vitest-tier misuse.
  const { code } = run(
    'node --test .claude/hooks/fleet/x/test/a.test.mts test/unit/b.test.mts',
  )
  assert.equal(code, 2)
})

test('allows node_modules/.bin/vitest run', () => {
  const { code } = run('node_modules/.bin/vitest run test/unit/foo.test.mts')
  assert.equal(code, 0)
})

test('allows pnpm test', () => {
  const { code } = run('pnpm test')
  assert.equal(code, 0)
})

test('non-Bash tool passes through', () => {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: 'foo.ts' },
    }),
    encoding: 'utf8',
  })
  assert.equal(r.status, 0)
})

test('malformed payload fails open', () => {
  const r = spawnSync('node', [HOOK], { input: 'not-json', encoding: 'utf8' })
  assert.equal(r.status, 0)
})
