/**
 * @file Unit tests for trust-downgrade-guard hook. Spawns the hook as a child
 *   process with synthesized PreToolUse payloads. Covers Bash + Edit/Write
 *   downgrade detection, single-use bypass consumption, the disabled env var,
 *   and fail-open.
 */

import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, test } from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  readonly code: number
  readonly stderr: string
}

function run(payload: object, env?: Record<string, string>): RunResult {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...(env ?? {}) },
  })
  return {
    code: typeof r.status === 'number' ? r.status : 0,
    stderr: String(r.stderr || ''),
  }
}

function bash(command: string, transcriptPath?: string): object {
  return {
    tool_name: 'Bash',
    tool_input: { command },
    transcript_path: transcriptPath,
  }
}

function edit(filePath: string, newString: string): object {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: filePath, new_string: newString },
  }
}

function write(filePath: string, content: string): object {
  return { tool_name: 'Write', tool_input: { file_path: filePath, content } }
}

// A transcript whose assistant turns contain `priorDowngrades` prior
// trust-all Bash calls, plus `phrases` user occurrences of the bypass.
function writeTranscript(opts: {
  priorDowngrades?: number
  phrases?: number
}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tdguard-tx-'))
  const p = path.join(dir, 'session.jsonl')
  const lines: string[] = []
  for (let i = 0; i < (opts.phrases ?? 0); i += 1) {
    lines.push(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Allow trust-downgrade bypass' },
      }),
    )
  }
  for (let i = 0; i < (opts.priorDowngrades ?? 0); i += 1) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'pnpm install --config.trustPolicy=trust-all' },
            },
          ],
        },
      }),
    )
  }
  writeFileSync(p, lines.join('\n'))
  return p
}

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'tdguard-repo-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

// ─── Bash downgrade detection ─────────────────────────────────────

test('blocks --config.trustPolicy=trust-all', () => {
  const r = run(bash('pnpm install --config.trustPolicy=trust-all'))
  assert.equal(r.code, 2)
  assert.match(r.stderr, /Blocked/)
  assert.match(r.stderr, /trustPolicy/)
})

test('blocks --config.minimumReleaseAge=0', () => {
  const r = run(bash('pnpm install --config.minimumReleaseAge=0'))
  assert.equal(r.code, 2)
})

test('blocks --dangerously-allow-all-scripts', () => {
  const r = run(bash('npm ci --dangerously-allow-all-scripts'))
  assert.equal(r.code, 2)
})

test('blocks ignore-scripts=false', () => {
  const r = run(bash('npm install --ignore-scripts=false'))
  assert.equal(r.code, 2)
})

test('allows --config.trustPolicy=no-downgrade (not a downgrade)', () => {
  const r = run(bash('pnpm install --config.trustPolicy=no-downgrade'))
  assert.equal(r.code, 0)
})

test('allows an ordinary pnpm install', () => {
  const r = run(bash('pnpm install'))
  assert.equal(r.code, 0)
})

// ─── Edit/Write downgrade detection ───────────────────────────────

test('blocks Edit setting trustPolicy to trust-all', () => {
  const f = path.join(tmp, 'pnpm-workspace.yaml')
  const r = run(edit(f, 'trustPolicy: trust-all'))
  assert.equal(r.code, 2)
})

test('blocks Write of pnpm-workspace.yaml missing no-downgrade', () => {
  const f = path.join(tmp, 'pnpm-workspace.yaml')
  const r = run(write(f, 'packages:\n  - .\nblockExoticSubdeps: true\n'))
  assert.equal(r.code, 2)
})

test('allows Write of pnpm-workspace.yaml that keeps the gates', () => {
  const f = path.join(tmp, 'pnpm-workspace.yaml')
  const r = run(
    write(f, 'trustPolicy: no-downgrade\nblockExoticSubdeps: true\n'),
  )
  assert.equal(r.code, 0)
})

test('blocks lowering minimumReleaseAge below the floor', () => {
  const f = path.join(tmp, 'pnpm-workspace.yaml')
  const r = run(edit(f, 'minimumReleaseAge: 60'))
  assert.equal(r.code, 2)
})

test('ignores edits to non-policy files', () => {
  const f = path.join(tmp, 'README.md')
  const r = run(edit(f, 'trustPolicy: trust-all (just docs prose)'))
  assert.equal(r.code, 0)
})

// ─── Single-use bypass ────────────────────────────────────────────

test('one unconsumed phrase authorizes one downgrade', () => {
  const tx = writeTranscript({ phrases: 1, priorDowngrades: 0 })
  const r = run(bash('pnpm install --config.trustPolicy=trust-all', tx))
  assert.equal(r.code, 0)
})

test('a phrase already consumed by a prior downgrade does not authorize a second', () => {
  const tx = writeTranscript({ phrases: 1, priorDowngrades: 1 })
  const r = run(bash('pnpm install --config.trustPolicy=trust-all', tx))
  assert.equal(r.code, 2)
})

test('two phrases authorize two downgrades (one prior, one now)', () => {
  const tx = writeTranscript({ phrases: 2, priorDowngrades: 1 })
  const r = run(bash('pnpm install --config.trustPolicy=trust-all', tx))
  assert.equal(r.code, 0)
})

// ─── Disable + fail-open ──────────────────────────────────────────

test('disabled via env var', () => {
  const r = run(bash('pnpm install --config.trustPolicy=trust-all'), {
    SOCKET_TRUST_DOWNGRADE_GUARD_DISABLED: '1',
  })
  assert.equal(r.code, 0)
})

test('fails open on malformed payload', () => {
  const r = spawnSync('node', [HOOK], { input: 'not json', env: process.env })
  assert.equal(typeof r.status === 'number' ? r.status : 0, 0)
})

test('non-gated tool is ignored', () => {
  const r = run({ tool_name: 'Read', tool_input: { file_path: '/x' } })
  assert.equal(r.code, 0)
})
