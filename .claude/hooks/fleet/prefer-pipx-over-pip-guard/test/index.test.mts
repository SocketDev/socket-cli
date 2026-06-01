// node --test specs for the prefer-pipx-over-pip-guard hook.

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

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pipx-guard-test-'))
  const p = path.join(dir, name)
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

test('Bash: pip install requests blocks', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pip install requests' },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /Blocked.*pip install/)
})

test('Bash: pip3 install black blocks', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pip3 install black' },
  })
  assert.strictEqual(r.code, 2)
})

test('Bash: python -m pip install foo blocks', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'python -m pip install foo' },
  })
  assert.strictEqual(r.code, 2)
})

test('Bash: python3.12 -m pip install foo blocks', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'python3.12 -m pip install foo' },
  })
  assert.strictEqual(r.code, 2)
})

test('Bash: pip install pipx passes (bootstrap)', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pip install pipx' },
  })
  assert.strictEqual(r.code, 0)
})

test('Bash: pip install --user pipx passes (bootstrap with flag)', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'python3 -m pip install --user pipx' },
  })
  assert.strictEqual(r.code, 0)
})

test('Bash: pip install -e . passes (editable current project)', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pip install -e .' },
  })
  assert.strictEqual(r.code, 0)
})

test('Bash: pip install -r requirements.txt passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pip install -r requirements.txt' },
  })
  assert.strictEqual(r.code, 0)
})

test('Bash: pipx install <pkg> passes (the recommended path)', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'pipx install black==24.10.0' },
  })
  assert.strictEqual(r.code, 0)
})

test('Bash: echo "pip install foo" in a quoted string passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'echo "to install run: pip install foo"',
    },
  })
  // The quoted-string isn't immune (we don't fully parse shell) — but
  // the pattern is `echo ...` so it doesn't look like an active install.
  // This test documents current behavior: we DO flag it. Real-world
  // shell scripts that need to mention pip install in echo strings
  // should either use the per-line allowlist via comment, or have the
  // user type the bypass phrase.
  assert.strictEqual(r.code, 2)
})

test('Edit: Dockerfile pip install line blocks', async () => {
  const p = tmpFile(
    'Dockerfile.test',
    'FROM alpine:3.21\nRUN apk add python3\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'FROM alpine:3.21\nRUN apk add python3\nRUN pip install requests\n',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /Dockerfile/)
})

test('Edit: shell script pip install line blocks', async () => {
  const p = tmpFile('install.sh', '#!/bin/bash\nset -e\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: '#!/bin/bash\nset -e\npip3 install some-tool\n',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('Edit: pre-existing pip install not re-flagged', async () => {
  const before = '#!/bin/bash\npip install requests\n'
  const p = tmpFile('foo.sh', before)
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: p,
      old_string: '#!/bin/bash',
      new_string: '#!/usr/bin/env bash',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('Edit: non-shell/dockerfile file passes', async () => {
  const p = tmpFile('foo.md', 'docs about pip install\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: 'docs: run `pip install requests` to test\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('Dockerfile: comment-only pip install passes', async () => {
  const p = tmpFile('Dockerfile.test', '')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: 'FROM alpine:3.21\n# fallback: pip install foo if pipx missing\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('Dockerfile: pipx install passes', async () => {
  const p = tmpFile('Dockerfile.test', '')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'FROM alpine:3.21\nRUN apk add python3 py3-pip\nRUN pipx install black==24.10.0\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('non-Bash/Edit/Write passes', async () => {
  const r = await runHook({
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/anything' },
  })
  assert.strictEqual(r.code, 0)
})
