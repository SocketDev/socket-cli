// node --test specs for the soak-exclude-scope-guard hook.

// prefer-async-spawn: streaming-stdio-required.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function tmpYaml(content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'soak-exclude-test-'))
  const p = path.join(dir, 'pnpm-workspace.yaml')
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

test('non-pnpm-workspace.yaml passes', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sxg-other-'))
  const p = path.join(dir, 'package.json')
  writeFileSync(p, '{}')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: 'minimumReleaseAgeExclude:\n  - defu@6.1.6\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('adding @socketsecurity/* glob passes', async () => {
  const p = tmpYaml("minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n")
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        "minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n  - '@socketsecurity/*'\n",
    },
  })
  assert.strictEqual(r.code, 0)
})

test('adding @stuie/* first-party glob passes', async () => {
  const p = tmpYaml("minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n")
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        "minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n  - '@stuie/*'\n",
    },
  })
  assert.strictEqual(r.code, 0)
})

test('adding @socketsecurity/lib@6.0.0 exact pin passes', async () => {
  const p = tmpYaml("minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n")
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        "minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n  - '@socketsecurity/lib@6.0.0'\n",
    },
  })
  assert.strictEqual(r.code, 0)
})

test('adding bare-name third-party entry blocks', async () => {
  const p = tmpYaml("minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n")
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        "minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n  - 'defu@6.1.6'\n",
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /soak-exclude-scope-guard.*Blocked/)
  assert.match(r.stderr, /defu/)
  assert.match(r.stderr, /overrides:/)
})

test('adding @anthropic-ai/* third-party scope blocks', async () => {
  const p = tmpYaml("minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n")
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        "minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n  - '@anthropic-ai/claude-code@2.1.92'\n",
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /@anthropic-ai/)
})

test('all four Socket scopes allowed', async () => {
  const p = tmpYaml("minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n")
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        "minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n  - '@socketsecurity/*'\n  - '@socketbin/*'\n  - '@socketaddon/*'\n",
    },
  })
  assert.strictEqual(r.code, 0)
})

test('pre-existing third-party entry not re-flagged', async () => {
  const before =
    "minimumReleaseAgeExclude:\n  - '@socketregistry/*'\n  - 'defu@6.1.6'\n"
  const p = tmpYaml(before)
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: p,
      old_string: '@socketregistry/*',
      new_string: '@socketsecurity/*',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('entry outside the block ignored', async () => {
  const p = tmpYaml("overrides:\n  defu: '>=6.1.6'\n")
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        "overrides:\n  defu: '>=6.1.6'\n  lodash: '>=4.17.21'\nminimumReleaseAgeExclude:\n  - '@socketsecurity/*'\n",
    },
  })
  assert.strictEqual(r.code, 0)
})
