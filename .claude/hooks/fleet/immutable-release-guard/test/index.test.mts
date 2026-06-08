// node --test specs for the immutable-release-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'imm-rel-test-'))
  const wfDir = path.join(dir, '.github', 'workflows')
  mkdirSync(wfDir, { recursive: true })
  const p = path.join(wfDir, 'release.yml')
  writeFileSync(p, content)
  return p
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
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

test('non-workflow file passes', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/foo.md',
      content: 'gh release create v1.0.0 file.tar.gz\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('workflow without gh release create passes', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content: 'jobs:\n  x:\n    steps:\n      - run: echo hi\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('3-step pattern passes', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  release:\n    steps:\n      - run: |\n          gh release create "$TAG" --draft --title "$TITLE" --notes "$NOTES"\n          gh release upload "$TAG" release/*.tar.gz\n          gh release edit "$TAG" --draft=false\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('3-step with --draft=true also passes', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  release:\n    steps:\n      - run: |\n          gh release create "$TAG" --draft=true --title "$TITLE"\n          gh release upload "$TAG" file.tar.gz\n          gh release edit "$TAG" --draft=false\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('multi-line draft form with backslash continuations passes', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  release:\n    steps:\n      - run: |\n          gh release create "$TAG" \\\n            --draft \\\n            --title "$TITLE" \\\n            --notes "$NOTES"\n          gh release upload "$TAG" file.tar.gz\n          gh release edit "$TAG" --draft=false\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('single-call form (no --draft) is blocked', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  release:\n    steps:\n      - run: gh release create "$TAG" --title "$TITLE" --notes "$NOTES" file.tar.gz\n',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('drive-by single-call form (just files) is blocked', async () => {
  const filePath = tmpWorkflow('')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  release:\n    steps:\n      - run: gh release create v1.0.0 file.tar.gz checksums.txt\n',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('bypass phrase passes', async () => {
  const filePath = tmpWorkflow('')
  const txDir = mkdtempSync(path.join(os.tmpdir(), 'imm-rel-tx-'))
  const transcriptPath = path.join(txDir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'user',
      message: { content: 'Allow immutable-release-pattern bypass' },
    }) + '\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: filePath,
      content:
        'jobs:\n  release:\n    steps:\n      - run: gh release create "$TAG" file.tar.gz\n',
    },
    transcript_path: transcriptPath,
  })
  assert.strictEqual(r.code, 0)
})
