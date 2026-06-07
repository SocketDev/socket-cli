// node --test specs for the report-location-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(
  payload: Record<string, unknown>,
  transcript?: string,
): Promise<Result> {
  if (transcript !== undefined) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'report-location-test-'))
    const tp = path.join(dir, 'session.jsonl')
    writeFileSync(tp, transcript)
    payload['transcript_path'] = tp
  }
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
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

function userTurn(text: string): string {
  return JSON.stringify({ type: 'user', message: { content: text } }) + '\n'
}

function write(
  file_path: string,
  content = '# placeholder\n',
): Record<string, unknown> {
  return { tool_name: 'Write', tool_input: { file_path, content } }
}

test('non-Edit/Write tool calls pass through', async () => {
  const r = await runHook({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  assert.strictEqual(r.code, 0)
})

test('report-shaped .md into docs/reports/ is blocked', async () => {
  const r = await runHook(
    write(
      '/p/socket-mcp/docs/reports/scanning-quality-2026-06-05.md',
      '# Quality Scan Report',
    ),
  )
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /report-location-guard/)
  assert.match(r.stderr, /\.claude\/reports/)
})

test('report-shaped .md into a bare reports/ is blocked', async () => {
  const r = await runHook(
    write(
      '/p/socket-mcp/reports/scanning-quality-2026-06-05.md',
      '# Quality Scan Report',
    ),
  )
  assert.strictEqual(r.code, 2)
})

test('report-shaped .md into a sub-package .claude/reports/ is blocked', async () => {
  const r = await runHook(
    write('/p/socket-mcp/packages/foo/.claude/reports/audit.md', '# Audit'),
  )
  assert.strictEqual(r.code, 2)
})

test('report-shaped .md into root .claude/reports/ is ALLOWED', async () => {
  const r = await runHook(
    write(
      '/p/socket-mcp/.claude/reports/scanning-quality-2026-06-05.md',
      '# Quality Scan Report',
    ),
  )
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('non-report .md under docs/reports/ passes (heuristic miss)', async () => {
  const r = await runHook(
    write('/p/socket-mcp/docs/reports/glossary.md', '# Glossary of terms'),
  )
  assert.strictEqual(r.code, 0)
})

test('report-shaped filename triggers even with neutral content', async () => {
  const r = await runHook(
    write('/p/socket-mcp/docs/reports/security-scan.md', 'no heading here'),
  )
  assert.strictEqual(r.code, 2)
})

test('bypass phrase lets a docs/reports/ report through', async () => {
  const r = await runHook(
    write(
      '/p/socket-mcp/docs/reports/scanning-quality.md',
      '# Quality Scan Report',
    ),
    userTurn('Allow report-location bypass'),
  )
  assert.strictEqual(r.code, 0)
})

test('unrelated .md elsewhere is irrelevant', async () => {
  const r = await runHook(write('/p/socket-mcp/README.md', '# socket-mcp'))
  assert.strictEqual(r.code, 0)
})

test('a normal source path is ignored', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/p/socket-mcp/lib/foo.ts',
      content: 'export const x = 1',
    },
  })
  assert.strictEqual(r.code, 0)
})
