// node --test specs for the minimum-release-age-guard hook.

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function tmpYaml(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mra-guard-test-'))
  const p = path.join(dir, 'pnpm-workspace.yaml')
  writeFileSync(p, content)
  return p
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end(JSON.stringify(payload))
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

test('non-Edit/Write tool passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
  })
  assert.strictEqual(r.code, 0)
})

test('Edit to a non-workspace file passes', async () => {
  const filePath = tmpYaml('foo: bar\n').replace(
    /pnpm-workspace\.yaml$/,
    'package.json',
  )
  writeFileSync(filePath, '{"foo": "bar"}')
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,
      old_string: '"bar"',
      new_string: '"baz"',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('Edit removes an exclude entry — passes', async () => {
  const filePath = tmpYaml(
    'minimumReleaseAge:\n  exclude:\n    - pkg-a\n    - pkg-b\n',
  )
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,
      old_string: '    - pkg-a\n    - pkg-b\n',
      new_string: '    - pkg-a\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('Edit adds a new exclude entry — blocked', async () => {
  const filePath = tmpYaml('minimumReleaseAge:\n  exclude:\n    - pkg-a\n')
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,
      old_string: '    - pkg-a\n',
      new_string: '    - pkg-a\n    - pkg-b\n',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.ok(r.stderr.includes('pkg-b'))
})

test('Write adds a fresh exclude — blocked', async () => {
  const filePath = tmpYaml('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content: 'minimumReleaseAge:\n  exclude:\n    - sketchy-pkg\n',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.ok(r.stderr.includes('sketchy-pkg'))
})

test('Edit with bypass phrase in transcript — passes', async () => {
  const filePath = tmpYaml('minimumReleaseAge:\n  exclude:\n    - pkg-a\n')
  const dir = mkdtempSync(path.join(tmpdir(), 'mra-guard-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'user',
      message: { content: 'Allow minimumReleaseAge bypass' },
    }) + '\n',
  )
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,
      old_string: '    - pkg-a\n',
      new_string: '    - pkg-a\n    - pkg-b\n',
    },
    transcript_path: transcriptPath,
  })
  assert.strictEqual(r.code, 0)
})
