// node --test specs for the verify-rendered-output-before-commit-reminder hook.

import { spawn, spawnSync } from '@socketsecurity/lib-stable/spawn'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function mkRepoWithStaged(stagedFiles: string[]): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'commit-rebuild-test-'))
  spawnSync('git', ['init', '-q'], { cwd: repo })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
  for (let i = 0, { length } = stagedFiles; i < length; i += 1) {
    const f = stagedFiles[i]!
    const p = path.join(repo, f)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, 'x')
  }
  spawnSync('git', ['add', ...stagedFiles], { cwd: repo })
  return repo
}

function mkTranscript(entries: object[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'commit-rebuild-tx-'))
  const p = path.join(dir, 'session.jsonl')
  writeFileSync(p, entries.map(e => JSON.stringify(e)).join('\n') + '\n')
  return p
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
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

test('non-commit Bash passes silently', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'ls -la' },
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('commit with no UI files staged — no reminder', async () => {
  const repo = mkRepoWithStaged(['src/foo.ts'])
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "feat: x"' },
    cwd: repo,
    transcript_path: mkTranscript([]),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('commit with UI files but no build in transcript — no reminder', async () => {
  const repo = mkRepoWithStaged(['site/index.html'])
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "feat: x"' },
    cwd: repo,
    transcript_path: mkTranscript([
      { type: 'user', message: { content: 'fix the page' } },
    ]),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('commit with UI files + recent build + no verify — reminder fires', async () => {
  const repo = mkRepoWithStaged(['site/index.html', 'site/app.css'])
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "feat: page" ' },
    cwd: repo,
    transcript_path: mkTranscript([
      { type: 'user', message: { content: 'rebuild the site' } },
      {
        type: 'assistant',
        message: {
          content: [{ name: 'Bash', input: { command: 'pnpm run build' } }],
        },
      },
    ]),
  })
  assert.strictEqual(r.code, 0)
  assert.ok(String(r.stderr).includes('verify-rendered-output-before-commit-reminder'))
})

test('commit with UI files + build + later user verify — no reminder', async () => {
  const repo = mkRepoWithStaged(['site/index.html'])
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "feat: page"' },
    cwd: repo,
    transcript_path: mkTranscript([
      {
        type: 'assistant',
        message: {
          content: [{ name: 'Bash', input: { command: 'pnpm run build' } }],
        },
      },
      { type: 'user', message: { content: 'looks good, ship it' } },
    ]),
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})
