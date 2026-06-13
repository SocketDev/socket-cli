// prefer-async-spawn: streaming-stdio-required — spawns the hook subprocess and
// pipes an Edit/Write payload on stdin, asserting on exit (always 0) + stderr.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

function changelogPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'changelog-shape-test-'))
  const p = path.join(dir, 'CHANGELOG.md')
  writeFileSync(p, '# Changelog\n')
  return p
}

function runWrite(
  filePath: string,
  content: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    void child.catch(() => undefined)
    let stderr = ''
    child.process.stderr!.on('data', d => {
      stderr += d.toString()
    })
    child.process.on('error', reject)
    child.process.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    child.stdin!.end(
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: filePath, content },
      }),
    )
  })
}

test('nudges a bullet with no agents.md link (exit 0, warns)', async () => {
  const { code, stderr } = await runWrite(
    changelogPath(),
    '## 1.2.0\n\n- Added a new flag for verbose output\n',
  )
  assert.equal(code, 0, 'always non-blocking')
  assert.match(stderr, /changelog-entry-shape-nudge/)
})

test('quiet when the bullet links an agents.md doc', async () => {
  const { code, stderr } = await runWrite(
    changelogPath(),
    '## 1.2.0\n\n- Added a verbose flag ([`verbose`](docs/agents.md/repo/verbose.md))\n',
  )
  assert.equal(code, 0)
  assert.doesNotMatch(stderr, /changelog-entry-shape-nudge/)
})

test('ignores indented sub-bullets', async () => {
  const { code, stderr } = await runWrite(
    changelogPath(),
    '## 1.2.0\n\n- Feature ([`x`](docs/agents.md/fleet/x.md))\n  - detail one\n  - detail two\n',
  )
  assert.equal(code, 0)
  assert.doesNotMatch(stderr, /changelog-entry-shape-nudge/)
})

test('a non-CHANGELOG file is ignored', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'changelog-shape-test-'))
  const p = path.join(dir, 'NOTES.md')
  writeFileSync(p, '# notes\n')
  const { code, stderr } = await runWrite(p, '- a bare bullet with no link\n')
  assert.equal(code, 0)
  assert.doesNotMatch(stderr, /changelog-entry-shape-nudge/)
})

test('headings and blank lines do not trigger', async () => {
  const { code, stderr } = await runWrite(
    changelogPath(),
    '# Changelog\n\n## 2.0.0\n\n',
  )
  assert.equal(code, 0)
  assert.doesNotMatch(stderr, /changelog-entry-shape-nudge/)
})

test('non-Edit/Write tool passes silently', async () => {
  const child = spawn(process.execPath, [HOOK], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  void child.catch(() => undefined)
  const code = await new Promise<number>(resolve => {
    child.process.on('exit', c => resolve(c ?? -1))
    child.stdin!.end(
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
    )
  })
  assert.equal(code, 0)
})

test('malformed payload fails open (exit 0)', async () => {
  const child = spawn(process.execPath, [HOOK], {
    stdio: ['pipe', 'ignore', 'pipe'],
  })
  void child.catch(() => undefined)
  const code = await new Promise<number>(resolve => {
    child.process.on('exit', c => resolve(c ?? -1))
    child.stdin!.end('{ not json')
  })
  assert.equal(code, 0)
})
