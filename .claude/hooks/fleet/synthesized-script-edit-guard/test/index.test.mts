// node --test specs for the synthesized-script-edit-guard hook.
//
// PreToolUse guard scoped to package.json Edit/Write. BLOCKS (exit 2) when the
// edit touches a `scripts` key that the cascade synthesizes from
// CANONICAL_SCRIPT_BODIES in the manifest. Wheelhouse-only: no manifest
// downstream → silent. Bypass phrase: `Allow synthesized-script-edit bypass`.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — the e2e cases spawn the hook
// and pipe a JSON payload on stdin, needing the ChildProcess stream surface.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')
const mod = await import(path.join(here, '..', 'index.mts'))
const { synthesizedScriptKeys, touchedSynthesizedKeys } = mod as {
  synthesizedScriptKeys: (text: string) => Set<string>
  touchedSynthesizedKeys: (content: string, keys: ReadonlySet<string>) => string[]
}

const MANIFEST_SRC = `export const OTHER = { 'not-a-script': 1 }
export const CANONICAL_SCRIPT_BODIES: Readonly<Record<string, string>> = {
  'check:paths': 'node scripts/fleet/check/paths-are-canonical.mts',
  cover: 'node scripts/fleet/cover.mts',
  'doctor:auth': 'node scripts/fleet/check/setup-is-prompt-less.mts',
  fix: 'node scripts/fleet/fix.mts',
}
export const AFTER = { 'later-key': 2 }
`

// ── synthesizedScriptKeys ───────────────────────────────────────

test('synthesizedScriptKeys extracts bare + quoted keys from the object', () => {
  const keys = synthesizedScriptKeys(MANIFEST_SRC)
  assert.equal(keys.has('check:paths'), true)
  assert.equal(keys.has('cover'), true)
  assert.equal(keys.has('doctor:auth'), true)
  assert.equal(keys.has('fix'), true)
})

test('synthesizedScriptKeys does NOT read keys from other objects (brace-scoped)', () => {
  const keys = synthesizedScriptKeys(MANIFEST_SRC)
  assert.equal(keys.has('not-a-script'), false)
  assert.equal(keys.has('later-key'), false)
})

test('synthesizedScriptKeys returns empty when the marker is absent', () => {
  assert.equal(synthesizedScriptKeys('export const X = { a: 1 }').size, 0)
})

test('synthesizedScriptKeys returns empty on a malformed (no-brace) declaration', () => {
  assert.equal(synthesizedScriptKeys('CANONICAL_SCRIPT_BODIES').size, 0)
})

// ── touchedSynthesizedKeys ──────────────────────────────────────

const KEYS = new Set(['doctor:auth', 'cover', 'check:paths'])

test('touchedSynthesizedKeys finds a JSON property whose name is synthesized', () => {
  const content = '{ "scripts": { "doctor:auth": "node x.mts" } }'
  assert.deepEqual(touchedSynthesizedKeys(content, KEYS), ['doctor:auth'])
})

test('touchedSynthesizedKeys matches a key containing a colon', () => {
  const content = '"check:paths": "node y.mts"'
  assert.deepEqual(touchedSynthesizedKeys(content, KEYS), ['check:paths'])
})

test('touchedSynthesizedKeys returns empty when no synthesized key is present', () => {
  const content = '{ "scripts": { "my:own": "node z.mts" } }'
  assert.deepEqual(touchedSynthesizedKeys(content, KEYS), [])
})

test('touchedSynthesizedKeys does not match a bare word without the JSON quote+colon', () => {
  // "cover" appearing in prose (no `"cover":`) must not fire.
  assert.deepEqual(touchedSynthesizedKeys('discover the cover art', KEYS), [])
})

// ── end-to-end (spawn the hook with a fixture repo) ─────────────

function fixtureRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'synth-script-'))
  mkdirSync(path.join(dir, 'scripts', 'repo', 'sync-scaffolding'), {
    recursive: true,
  })
  writeFileSync(
    path.join(dir, 'scripts', 'repo', 'sync-scaffolding', 'manifest.mts'),
    MANIFEST_SRC,
  )
  return dir
}

// Write a one-line transcript JSONL carrying a user turn with `text`, so the
// hook's bypassPhrasePresent() lookback can find a bypass phrase.
function transcriptWith(dir: string, text: string): string {
  const p = path.join(dir, 'transcript.jsonl')
  writeFileSync(
    p,
    JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) +
      '\n',
  )
  return p
}

function runHook(
  payload: unknown,
  env: Record<string, string>,
): Promise<{ code: number; stderr: string }> {
  return new Promise(resolve => {
    const spawned = spawn('node', [HOOK], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // lib's spawn() returns a thenable that REJECTS on non-zero exit. This
    // guard exits 2 by design, so swallow that rejection — the close listener
    // below is the source of truth for the exit code.
    spawned.catch(() => {})
    const child = spawned.process
    let stderr = ''
    child.stderr!.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('close', (code: number | null) => {
      resolve({ code: code ?? 0, stderr })
    })
    child.stdin!.end(JSON.stringify(payload))
  })
}

test('e2e: BLOCKS (exit 2) on a package.json edit touching a synthesized key', async () => {
  const repo = fixtureRepo()
  const { code, stderr } = await runHook(
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(repo, 'package.json'),
        new_string: '"doctor:auth": "node scripts/fleet/check/x.mts"',
      },
    },
    { CLAUDE_PROJECT_DIR: repo },
  )
  assert.equal(code, 2)
  assert.match(stderr, /synthesized-script-edit-guard/)
  assert.match(stderr, /doctor:auth/)
})

test('e2e: bypass phrase in transcript → allows the edit (exit 0)', async () => {
  const repo = fixtureRepo()
  const tp = transcriptWith(repo, 'Allow synthesized-script-edit bypass')
  const { code } = await runHook(
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(repo, 'package.json'),
        new_string: '"doctor:auth": "node scripts/fleet/check/x.mts"',
      },
      transcript_path: tp,
    },
    { CLAUDE_PROJECT_DIR: repo },
  )
  assert.equal(code, 0)
})

test('e2e: silent (exit 0) on a package.json edit touching only a NON-synthesized key', async () => {
  const repo = fixtureRepo()
  const { code, stderr } = await runHook(
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(repo, 'package.json'),
        new_string: '"my:own": "node scripts/mine.mts"',
      },
    },
    { CLAUDE_PROJECT_DIR: repo },
  )
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})

test('e2e: silent on a non-package.json edit', async () => {
  const repo = fixtureRepo()
  const { code, stderr } = await runHook(
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(repo, 'README.md'),
        new_string: '"doctor:auth": something',
      },
    },
    { CLAUDE_PROJECT_DIR: repo },
  )
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})

test('e2e: silent when no manifest is present (downstream fleet repo)', async () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'synth-no-manifest-'))
  const { code, stderr } = await runHook(
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(repo, 'package.json'),
        new_string: '"doctor:auth": "node x.mts"',
      },
    },
    { CLAUDE_PROJECT_DIR: repo },
  )
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})

test('e2e: silent on a non-Edit/Write tool', async () => {
  const repo = fixtureRepo()
  const { code, stderr } = await runHook(
    { tool_name: 'Bash', tool_input: { command: 'echo hi' } },
    { CLAUDE_PROJECT_DIR: repo },
  )
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})
