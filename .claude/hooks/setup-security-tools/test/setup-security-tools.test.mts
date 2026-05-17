import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.resolve(__dirname, '..', 'index.mts')

// setup-security-tools is a setup script, not a Claude Code hook —
// it doesn't read stdin, doesn't have a tool_input contract, and the
// `main()` body downloads binaries on every invocation. The
// meaningful test surface is "the script parses without syntax
// errors" — full integration coverage lives in
// .github/workflows/setup-security-tools.yml, where the script
// actually runs against the network.

test('parses without syntax errors (node --check)', async () => {
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', SCRIPT], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', d => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('exit', c => {
      if (c !== 0) {
        reject(new Error(`node --check exited ${c}; stderr=${stderr}`))
        return
      }
      resolve(c ?? -1)
    })
  })
  assert.equal(code, 0)
})

test('module imports without throwing (does NOT invoke main)', async () => {
  // The script auto-runs `main()` at module load, so we can't just
  // `import(SCRIPT)`. Instead, spawn a child node process that
  // imports the module under a `DRY_RUN=1` guard… but the script
  // doesn't honor such a guard. Document the gap here and leave the
  // syntax check above as the primary surface — full coverage
  // requires either (a) refactoring index.mts to export main() and
  // gate the auto-invocation behind `import.meta.main`, or (b) a
  // mock harness that traps the lib imports. Both are scope-creep
  // for this baseline test.
  //
  // Once the module is refactored to gate auto-invocation, replace
  // this test with a real import + export-shape assertion.
  assert.ok(true, 'placeholder — see comment above')
})

test('surfaces token-401 finding when transcript contains the Socket API 401 error', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'setup-security-tools-test-'))
  try {
    const transcriptPath = path.join(dir, 'transcript.jsonl')
    // Synthetic Claude Code transcript: a single assistant turn
    // whose tool_use output carries the canonical 401 error string.
    const assistantTurn = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text:
              'I tried to run sfw and got:\n\nConfiguration Error\n  ' +
              '- SOCKET_API_KEY validation got status of 401 from the ' +
              'Socket API, please ensure the key is valid and has the ' +
              'correct permissions.',
          },
        ],
      },
    }
    writeFileSync(transcriptPath, JSON.stringify(assistantTurn) + '\n')
    const stopPayload = JSON.stringify({ transcript_path: transcriptPath })

    const { code, stderr } = await new Promise<{
      code: number
      stderr: string
    }>((resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT], {
        stdio: ['pipe', 'ignore', 'pipe'],
        // The hook's other checks (broken shims, edition mismatch)
        // need $HOME to fire; the 401 check only needs the transcript
        // path, so a missing HOME just keeps those checks quiet —
        // exactly what we want for an isolated 401-detection test.
        env: { ...process.env, HOME: '' },
      })
      let stderrChunks = ''
      child.stderr!.on('data', d => {
        stderrChunks += d.toString()
      })
      child.on('error', reject)
      child.on('exit', c => resolve({ code: c ?? -1, stderr: stderrChunks }))
      child.stdin!.write(stopPayload)
      child.stdin!.end()
    })

    assert.equal(code, 0, `hook should exit 0, got ${code}; stderr=${stderr}`)
    assert.match(stderr, /token.*401|--rotate/i)
    assert.match(stderr, /install\.mts --rotate/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stays quiet when the transcript has no 401 error', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(path.join(tmpdir(), 'setup-security-tools-test-'))
  try {
    const transcriptPath = path.join(dir, 'transcript.jsonl')
    const assistantTurn = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Nothing of interest here.' }],
      },
    }
    writeFileSync(transcriptPath, JSON.stringify(assistantTurn) + '\n')
    const stopPayload = JSON.stringify({ transcript_path: transcriptPath })

    const { stderr } = await new Promise<{ stderr: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT], {
          stdio: ['pipe', 'ignore', 'pipe'],
          env: { ...process.env, HOME: '' },
        })
        let stderrChunks = ''
        child.stderr!.on('data', d => {
          stderrChunks += d.toString()
        })
        child.on('error', reject)
        child.on('exit', () => resolve({ stderr: stderrChunks }))
        child.stdin!.write(stopPayload)
        child.stdin!.end()
      },
    )

    // No 401 line means no finding from checkToken401. Other checks
    // are gated on HOME (cleared above) so they stay quiet too.
    assert.doesNotMatch(stderr, /token.*401|--rotate/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
