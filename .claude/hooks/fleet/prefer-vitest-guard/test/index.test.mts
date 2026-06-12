import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'index.mts',
)

function run(command: string, transcriptLines: string[] = [], cwd?: string) {
  // When transcript lines are given, write them as a JSONL transcript and
  // point the payload at it, so the bypass-phrase check has something to read.
  let transcriptPath: string | undefined
  if (transcriptLines.length) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pvg-tx-'))
    transcriptPath = path.join(dir, 'transcript.jsonl')
    writeFileSync(
      transcriptPath,
      transcriptLines
        .map(l =>
          JSON.stringify({
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: l }] },
          }),
        )
        .join('\n'),
    )
  }
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      transcript_path: transcriptPath,
    }),
    encoding: 'utf8',
    ...(cwd ? { cwd } : {}),
  })
  if (transcriptPath) {
    rmSync(path.dirname(transcriptPath), { recursive: true, force: true })
  }
  return { code: r.status ?? -1, stderr: r.stderr }
}

test('blocks node --test <file>', () => {
  const { code, stderr } = run('node --test test/unit/foo.test.mts')
  assert.equal(code, 2)
  assert.match(stderr, /prefer-vitest-guard/)
  assert.match(stderr, /node_modules\/\.bin\/vitest run/)
  assert.match(stderr, /test\/unit\/foo\.test\.mts/)
})

test('the bypass phrase in the transcript allows an otherwise-blocked run', () => {
  // Same command that's blocked above, but a recent user turn carries the
  // canonical phrase verbatim → the guard lets it through.
  const { code } = run('node --test test/unit/foo.test.mts', [
    'Allow node-test-runner bypass',
  ])
  assert.equal(code, 0)
})

test('an unrelated transcript line does NOT bypass', () => {
  const { code } = run('node --test test/unit/foo.test.mts', [
    'please allow the node test runner',
  ])
  assert.equal(code, 2)
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
  // .config/oxlint-plugin/<tier>/<rule>/test/** is vitest-excluded → node --test tier.
  const { code } = run(
    'node --test .config/oxlint-plugin/fleet/max-file-lines/test/max-file-lines.test.mts',
  )
  assert.equal(code, 0)
})

test('allows node --test for an oxlint-plugin test glob', () => {
  const { code } = run(
    'node --test .config/oxlint-plugin/fleet/max-file-lines/test/*.test.mts',
  )
  assert.equal(code, 0)
})

test('allows a repo-owned extra-exclude node:test tier; blocks it without the file', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pvg-'))
  try {
    // No repo config yet → tools/ test is NOT a known tier → blocked.
    const blocked = run(
      'node --test tools/prim/test/fixtures.test.mts',
      [],
      tmp,
    )
    assert.equal(blocked.code, 2)

    // Declare the repo-owned tier via vitest.json's nodeTestExclude key → the
    // same target is now allowed.
    mkdirSync(path.join(tmp, '.config', 'repo'), { recursive: true })
    writeFileSync(
      path.join(tmp, '.config', 'repo', 'vitest.json'),
      JSON.stringify({ nodeTestExclude: ['tools/**/test/**'] }),
    )
    const allowed = run(
      'node --test tools/prim/test/fixtures.test.mts',
      [],
      tmp,
    )
    assert.equal(allowed.code, 0)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
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
