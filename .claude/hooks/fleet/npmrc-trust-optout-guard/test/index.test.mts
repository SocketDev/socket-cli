/**
 * @file Unit tests for npmrc-trust-optout-guard. Spawns the hook with
 *   synthesized PreToolUse payloads. Covers the Bash env-var surface, the
 *   Edit/Write committed-file surface, the `${ENV}`-beside-auth-key shape, the
 *   benign HOME/`/dev/null` cases, the bypass, and fail-open.
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

function run(payload: object): RunResult {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    env: process.env,
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

function edit(filePath: string, newString: string, transcriptPath?: string): object {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: filePath, new_string: newString },
    transcript_path: transcriptPath,
  }
}

function write(filePath: string, content: string): object {
  return { tool_name: 'Write', tool_input: { file_path: filePath, content } }
}

function transcriptWithBypass(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nto-tx-'))
  const p = path.join(dir, 'session.jsonl')
  writeFileSync(
    p,
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Allow npmrc-trust-optout bypass' },
    }),
  )
  return p
}

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'nto-repo-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

// ─── Bash env-var surface ─────────────────────────────────────────

test('blocks PNPM_CONFIG_NPMRC_AUTH_FILE prefix assignment', () => {
  const r = run(bash('PNPM_CONFIG_NPMRC_AUTH_FILE=.npmrc pnpm install'))
  assert.equal(r.code, 2)
  assert.match(r.stderr, /PNPM_CONFIG_NPMRC_AUTH_FILE/)
})

test('blocks export NPM_CONFIG_USERCONFIG=.npmrc', () => {
  const r = run(bash('export NPM_CONFIG_USERCONFIG=.npmrc'))
  assert.equal(r.code, 2)
})

test('blocks bare NPM_CONFIG_USERCONFIG=./.npmrc', () => {
  const r = run(bash('NPM_CONFIG_USERCONFIG=./.npmrc'))
  assert.equal(r.code, 2)
})

test('blocks the var on the second command of an && chain', () => {
  const r = run(bash('echo ok && PNPM_CONFIG_NPMRC_AUTH_FILE=x pnpm i'))
  assert.equal(r.code, 2)
})

test('allows NPM_CONFIG_USERCONFIG pointed at a HOME .npmrc', () => {
  const r = run(bash('export NPM_CONFIG_USERCONFIG=~/.npmrc'))
  assert.equal(r.code, 0)
})

test('allows NPM_CONFIG_USERCONFIG=/dev/null', () => {
  const r = run(bash('NPM_CONFIG_USERCONFIG=/dev/null pnpm i'))
  assert.equal(r.code, 0)
})

test('allows an ordinary pnpm install', () => {
  const r = run(bash('pnpm install'))
  assert.equal(r.code, 0)
})

// ─── Edit/Write committed-file surface ────────────────────────────

test('blocks landing the opt-out var into a committed shell script', () => {
  const f = path.join(tmp, 'ci.sh')
  const r = run(edit(f, 'export PNPM_CONFIG_NPMRC_AUTH_FILE=.npmrc\n'))
  assert.equal(r.code, 2)
})

test('blocks the var in a workflow YAML under .github', () => {
  const f = path.join(tmp, '.github', 'workflows', 'ci.yml')
  const r = run(write(f, 'env:\n  NPM_CONFIG_USERCONFIG: .npmrc\n'))
  assert.equal(r.code, 2)
})

test('blocks ${ENV} beside _authToken in a committed .npmrc', () => {
  const f = path.join(tmp, '.npmrc')
  const r = run(edit(f, '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n'))
  assert.equal(r.code, 2)
  assert.match(r.stderr, /placeholder/)
})

test('allows an ordinary .npmrc edit with no auth placeholder', () => {
  const f = path.join(tmp, '.npmrc')
  const r = run(edit(f, 'min-release-age=7\nignore-scripts=true\n'))
  assert.equal(r.code, 0)
})

test('ignores a non-committed scratch file', () => {
  const f = path.join(tmp, 'notes.txt')
  const r = run(edit(f, 'export PNPM_CONFIG_NPMRC_AUTH_FILE=.npmrc'))
  assert.equal(r.code, 0)
})

// ─── Bypass ───────────────────────────────────────────────────────

test('bypass phrase authorizes the Bash opt-out', () => {
  const tx = transcriptWithBypass()
  const r = run(bash('PNPM_CONFIG_NPMRC_AUTH_FILE=.npmrc pnpm i', tx))
  assert.equal(r.code, 0)
})

test('bypass phrase authorizes the Edit opt-out', () => {
  const tx = transcriptWithBypass()
  const f = path.join(tmp, '.npmrc')
  const r = run(edit(f, '//r/:_authToken=${T}\n', tx))
  assert.equal(r.code, 0)
})

// ─── Fail-open ────────────────────────────────────────────────────

test('fails open on malformed payload', () => {
  const r = spawnSync('node', [HOOK], { input: 'not json', env: process.env })
  assert.equal(typeof r.status === 'number' ? r.status : 0, 0)
})

test('non-gated tool is ignored', () => {
  const r = run({ tool_name: 'Read', tool_input: { file_path: '/x' } })
  assert.equal(r.code, 0)
})
