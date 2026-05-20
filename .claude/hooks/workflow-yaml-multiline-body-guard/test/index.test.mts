// node --test specs for the workflow-yaml-multiline-body-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/spawn'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function tmpWorkflow(content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wf-yaml-test-'))
  const wfDir = path.join(dir, '.github', 'workflows')
  mkdirSync(wfDir, { recursive: true })
  const p = path.join(wfDir, 'test.yml')
  writeFileSync(p, content)
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

test('non-workflow file passes', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/foo.md',
      content: '# Heading\ngh pr create --body "## multi\nline"\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('workflow with single-line --body passes', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gh pr create --body "single line"\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('workflow with --body-file passes', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  x:\n    steps:\n      - run: gh pr create --body-file /tmp/body.md\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('workflow with --body "$VAR" passes', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  x:\n    steps:\n      - run: gh pr create --body "$BODY"\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('workflow with multi-line --body literal blocked', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  x:\n    steps:\n      - run: gh pr create --body "## Title\n- item\n"\n',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('bypass phrase passes', async () => {
  const filePath = tmpWorkflow('')
  const txDir = mkdtempSync(path.join(os.tmpdir(), 'wf-tx-'))
  const transcriptPath = path.join(txDir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'user',
      message: { content: 'Allow workflow-yaml-multiline-body bypass' },
    }) + '\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  x:\n    steps:\n      - run: gh pr create --body "## Title\n- item\n"\n',
    },
    transcript_path: transcriptPath,
  })
  assert.strictEqual(r.code, 0)
})
