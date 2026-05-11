// node --test specs for the no-fleet-fork-guard hook.
//
// Spawns the hook as a subprocess (matches production runtime), pipes
// a JSON payload on stdin, captures stderr + exit code.
//
// Tests use a temp git-style repo skeleton — empty package.json plus
// a CLAUDE.md with or without the FLEET-CANONICAL marker — so we can
// exercise the "is this a fleet repo?" walk-up logic without
// depending on actual fleet-repo checkouts.

import { spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(
  payload: Record<string, unknown>,
  transcript?: string,
): Promise<Result> {
  let transcriptPath: string | undefined
  if (transcript !== undefined) {
    const dir = mkdtempSync(path.join(tmpdir(), 'no-fleet-fork-test-'))
    transcriptPath = path.join(dir, 'session.jsonl')
    writeFileSync(transcriptPath, transcript)
    payload['transcript_path'] = transcriptPath
  }
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

function userTurn(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n'
}

interface RepoSetup {
  hasFleetCanonical: boolean
}

/** Create a temp dir that looks like a fleet repo. */
function makeFakeFleetRepo(setup: RepoSetup = { hasFleetCanonical: true }): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'fake-fleet-repo-'))
  writeFileSync(path.join(repo, 'package.json'), '{"name":"fake-fleet"}\n')
  const claudeMarker = setup.hasFleetCanonical
    ? '<!-- BEGIN FLEET-CANONICAL -->\nrules go here\n<!-- END FLEET-CANONICAL -->\n'
    : '# Just a regular project README-style markdown\n'
  writeFileSync(path.join(repo, 'CLAUDE.md'), claudeMarker)
  return repo
}

function makeCanonicalFile(repo: string, relPath: string): string {
  const full = path.join(repo, relPath)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, '// existing content\n')
  return full
}

test('non-Edit/Write tool calls pass through untouched', async () => {
  const result = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('Edit on a non-canonical path inside a fleet repo passes', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, 'src/foo.ts')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Edit on a canonical path outside a fleet repo passes', async () => {
  // Tmp dir without CLAUDE.md → the walk-up never finds a fleet root.
  const dir = mkdtempSync(path.join(tmpdir(), 'non-fleet-'))
  try {
    const file = path.join(dir, '.config/oxlint-plugin/rules/foo.mts')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '// content\n')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('Edit on .config/oxlint-plugin/rules/* in a fleet repo is BLOCKED', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(
      repo,
      '.config/oxlint-plugin/rules/example.mts',
    )
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 2)
    assert.match(result.stderr, /no-fleet-fork-guard/)
    assert.match(result.stderr, /\.config\/oxlint-plugin\/rules\/example\.mts/)
    assert.match(result.stderr, /Allow fleet-fork bypass/)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Edit on .git-hooks/* in a fleet repo is BLOCKED', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, '.git-hooks/_helpers.mts')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 2)
    assert.match(result.stderr, /\.git-hooks\/_helpers\.mts/)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Edit on .claude/hooks/* in a fleet repo is BLOCKED', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, '.claude/hooks/some-hook/index.mts')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 2)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Edit on docs/claude.md/* in a fleet repo is BLOCKED', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, 'docs/claude.md/sorting.md')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 2)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Write tool also blocked, not just Edit', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(
      repo,
      '.config/oxlint-plugin/rules/new-rule.mts',
    )
    const result = await runHook({
      tool_input: { file_path: file, content: 'export default {}' },
      tool_name: 'Write',
    })
    assert.strictEqual(result.code, 2)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('MultiEdit tool also blocked', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(
      repo,
      '.config/oxlint-plugin/rules/foo.mts',
    )
    const result = await runHook({
      tool_input: { file_path: file, edits: [] },
      tool_name: 'MultiEdit',
    })
    assert.strictEqual(result.code, 2)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('repo without FLEET-CANONICAL marker passes through', async () => {
  // Project that has CLAUDE.md but is NOT a fleet member — the walk-up
  // sees CLAUDE.md but no marker, so the path doesn't qualify.
  const repo = makeFakeFleetRepo({ hasFleetCanonical: false })
  try {
    const file = makeCanonicalFile(repo, '.config/oxlint-plugin/rules/x.mts')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('bypass phrase in recent user turn allows the edit', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, '.git-hooks/pre-push.mts')
    const result = await runHook(
      {
        tool_input: { file_path: file, new_string: 'x' },
        tool_name: 'Edit',
      },
      userTurn('please do this Allow fleet-fork bypass thanks'),
    )
    assert.strictEqual(result.code, 0)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('bypass phrase variants do NOT count', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, '.git-hooks/pre-push.mts')
    // Each of these should NOT bypass — phrase must be exact.
    for (const variant of [
      'allow fleet-fork bypass',         // lowercase
      'Allow fleet fork bypass',          // space instead of hyphen
      'Allow fleet-fork',                 // no "bypass"
      'fleet-fork bypass',                // no "Allow"
    ]) {
      const result = await runHook(
        {
          tool_input: { file_path: file, new_string: 'x' },
          tool_name: 'Edit',
        },
        userTurn(variant),
      )
      assert.strictEqual(
        result.code,
        2,
        `variant should not bypass: ${variant}`,
      )
    }
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('paths under socket-wheelhouse/template/ always pass', async () => {
  // Even if Claude tries to spell out a path that would otherwise
  // match a canonical prefix, anything under .../socket-wheelhouse/
  // template/ is allowed since that IS the canonical home.
  const repo = mkdtempSync(path.join(tmpdir(), 'fake-srt-'))
  try {
    const file = path.join(
      repo,
      'socket-wheelhouse/template/.git-hooks/_helpers.mts',
    )
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '// canonical home\n')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('malformed JSON payload fails open with stderr log', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end('not-json{{{')
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.on('exit', code => resolve({ code: code ?? 0, stderr }))
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /fail-open/)
})

test('empty stdin passes through', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end('')
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.on('exit', code => resolve({ code: code ?? 0, stderr }))
  })
  assert.strictEqual(result.code, 0)
})
