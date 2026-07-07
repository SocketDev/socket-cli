// node --test specs for the no-fleet-fork-guard hook.
//
// Spawns the hook as a subprocess (matches production runtime), pipes
// a JSON payload on stdin, captures stderr + exit code.
//
// Tests use a temp git-style repo skeleton — empty package.json plus
// a CLAUDE.md with or without the FLEET-CANONICAL marker — so we can
// exercise the "is this a fleet repo?" walk-up logic without
// depending on actual fleet-repo checkouts.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
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
    const dir = mkdtempSync(path.join(os.tmpdir(), 'no-fleet-fork-test-'))
    transcriptPath = path.join(dir, 'session.jsonl')
    writeFileSync(transcriptPath, transcript)
    payload['transcript_path'] = transcriptPath
  }
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  // v6 lib-stable spawn returns an enriched Promise that rejects on
  // non-zero exit; this test reads stderr + exit via manual listeners
  // instead. Swallow the Promise rejection so it doesn't race the
  // listener-based resolve and trigger "async activity after test ended".
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

function userTurn(text: string): string {
  return (
    JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) +
    '\n'
  )
}

interface RepoSetup {
  hasFleetCanonical: boolean
}

/**
 * Create a temp dir that looks like a fleet repo.
 */
function makeFakeFleetRepo(
  setup: RepoSetup = { hasFleetCanonical: true },
): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'fake-fleet-repo-'))
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
  // Mirror the parent dir under template/ so the hook's directory-level
  // probe sees it as fleet-canonical. Skip repo/ paths — the template
  // intentionally has no repo/ dirs, which is what makes them pass through.
  const normalizedRel = relPath.replace(/\\/g, '/')
  if (!normalizedRel.includes('/repo/')) {
    mkdirSync(path.join(repo, 'template', path.dirname(relPath)), {
      recursive: true,
    })
  }
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
    // Create file directly — no template twin — so the dir probe returns false.
    const file = path.join(repo, 'src/foo.ts')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, '// content\n')
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'non-fleet-'))
  try {
    const file = path.join(dir, '.config/oxlint-plugin/fleet/foo/index.mts')
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

test('Edit on .config/oxlint-plugin/fleet/* in a fleet repo is BLOCKED', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(
      repo,
      '.config/oxlint-plugin/fleet/example/index.mts',
    )
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 2)
    assert.match(result.stderr, /no-fleet-fork-guard/)
    // The block message echoes the canonical template path for the edited
    // file — the oxlint plugin lives under .config/oxlint-plugin/fleet/.
    assert.match(
      result.stderr,
      /\.config\/oxlint-plugin\/fleet\/example\/index\.mts/,
    )
    assert.match(result.stderr, /Allow fleet-fork bypass/)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Edit on .git-hooks/* in a fleet repo is BLOCKED', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, '.git-hooks/_shared/helpers.mts')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 2)
    assert.match(result.stderr, /\.git-hooks\/_shared\/helpers\.mts/)
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

test('Edit on docs/agents.md/* in a fleet repo is BLOCKED', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, 'docs/agents.md/sorting.md')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 2)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Edit on docs/agents.md/repo/* in a fleet repo is ALLOWED (per-repo carve-out)', async () => {
  // The repo/ subdirectory is the per-repo analog of fleet/. Host repos
  // drop architecture/commands/build detail here to fit the whole-file
  // size cap without cascading the content fleet-wide.
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, 'docs/agents.md/repo/architecture.md')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Write tool also blocked, not just Edit', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(
      repo,
      '.config/oxlint-plugin/fleet/new-rule/index.mts',
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
      '.config/oxlint-plugin/fleet/foo/index.mts',
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
    const file = makeCanonicalFile(
      repo,
      '.config/oxlint-plugin/fleet/x/index.mts',
    )
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
    const file = makeCanonicalFile(repo, '.git-hooks/fleet/pre-push.mts')
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
    const file = makeCanonicalFile(repo, '.git-hooks/fleet/pre-push.mts')
    // Each of these should NOT bypass: a word of the phrase is missing.
    // (Case + dash/space variants DO count — see the next test.)
    for (const variant of [
      'Allow fleet-fork', // no "bypass"
      'fleet-fork bypass', // no "Allow"
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

test('case / hyphen / space / dash variants of the phrase all count', async () => {
  const repo = makeFakeFleetRepo()
  try {
    const file = makeCanonicalFile(repo, '.git-hooks/fleet/pre-push.mts')
    // The normalizer lowercases + folds dash variants + whitespace, so a
    // human typing lowercase, spaces, or an em-dash instead of the canonical
    // mixed-case hyphenated phrase still bypasses. Only the words + order matter.
    for (const variant of [
      'Allow fleet-fork bypass', // canonical
      'allow fleet-fork bypass', // lowercase
      'ALLOW FLEET-FORK BYPASS', // uppercase
      'Allow fleet fork bypass', // spaces instead of hyphen
      'Allow fleet—fork bypass', // em-dash
    ]) {
      const result = await runHook(
        {
          tool_input: { file_path: file, new_string: 'x' },
          tool_name: 'Edit',
        },
        userTurn(variant),
      )
      assert.strictEqual(result.code, 0, `variant should bypass: ${variant}`)
    }
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('paths under socket-wheelhouse/template/ always pass', async () => {
  // Even if Claude tries to spell out a path that would otherwise
  // match a canonical prefix, anything under .../socket-wheelhouse/
  // template/ is allowed since that IS the canonical home.
  const repo = mkdtempSync(path.join(os.tmpdir(), 'fake-srt-'))
  try {
    const file = path.join(
      repo,
      'socket-wheelhouse/template/.git-hooks/_shared/helpers.mts',
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
  child.stdin!.end('not-json{{{')
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.process.on('exit', code => resolve({ code: code ?? 0, stderr }))
  })
  assert.strictEqual(result.code, 0)
  assert.match(result.stderr, /fail-open/)
})

test('empty stdin passes through', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin!.end('')
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result = await new Promise<Result>(resolve => {
    child.process.on('exit', code => resolve({ code: code ?? 0, stderr }))
  })
  assert.strictEqual(result.code, 0)
})

// Root-level files (dirname === '.') previously mis-resolved to `template/.`
// (the template dir, which always exists) and were wrongly blocked. A root file
// is canonical only when an actual template/<file> twin exists.
test('Edit on a root-level file with NO template twin passes (e.g. pnpm-workspace.yaml)', async () => {
  const repo = makeFakeFleetRepo()
  try {
    // The repo HAS a template/ dir but no template/pnpm-workspace.yaml.
    mkdirSync(path.join(repo, 'template'), { recursive: true })
    const file = path.join(repo, 'pnpm-workspace.yaml')
    writeFileSync(file, 'catalog:\n')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Edit on CLAUDE.md (hybrid file WITH FLEET-CANONICAL markers) is ALLOWED', async () => {
  // CLAUDE.md carries BEGIN/END FLEET-CANONICAL markers: only the block between
  // them is canonical, so the preamble + project-specific postamble are
  // repo-owned and editing them is not a fork. A fork inside the block is caught
  // by the sync's claude_md_fleet_drift check at commit time.
  const repo = makeFakeFleetRepo()
  try {
    mkdirSync(path.join(repo, 'template'), { recursive: true })
    writeFileSync(path.join(repo, 'template/CLAUDE.md'), '# canonical\n')
    const file = path.join(repo, 'CLAUDE.md')
    const result = await runHook({
      tool_input: { file_path: file, new_string: 'x' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Edit on a root-level canonical file WITHOUT fleet-block markers is BLOCKED', async () => {
  // A root file that has a template/ twin but carries NO BEGIN/END markers is
  // fully canonical (not a hybrid) — editing it downstream is a fork.
  const repo = makeFakeFleetRepo()
  try {
    mkdirSync(path.join(repo, 'template'), { recursive: true })
    writeFileSync(path.join(repo, 'template/oxlintrc.json'), '{}\n')
    const file = path.join(repo, 'oxlintrc.json')
    writeFileSync(file, '{}\n')
    const result = await runHook({
      tool_input: { file_path: file, new_string: '{"x":1}' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 2)
    assert.match(result.stderr, /no-fleet-fork-guard/)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

// A wheelhouse checkout is identified by `template/CLAUDE.md` (the
// byte-canonical marker every wheelhouse has, downstream repos don't).
function makeFakeWheelhouseRepo(): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'fake-wheelhouse-'))
  writeFileSync(path.join(repo, 'package.json'), '{"name":"socket-wheelhouse"}\n')
  writeFileSync(path.join(repo, 'CLAUDE.md'), '# socket-wheelhouse\n')
  mkdirSync(path.join(repo, 'template'), { recursive: true })
  // The wheelhouse marker + the README PLACEHOLDER (distinct from the
  // wheelhouse's own authored root README).
  writeFileSync(path.join(repo, 'template/CLAUDE.md'), '# <REPO_NAME>\n')
  writeFileSync(path.join(repo, 'template/README.md'), '# <REPO_NAME>\n')
  return repo
}

test("Edit on the wheelhouse's OWN root README.md is ALLOWED (repo-owned, not a cascade copy)", async () => {
  const repo = makeFakeWheelhouseRepo()
  try {
    const file = path.join(repo, 'README.md')
    writeFileSync(file, '# socket-wheelhouse\n\nFleet axes prose.\n')
    const result = await runHook({
      tool_input: { file_path: file, new_string: '# socket-wheelhouse (edited)' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0)
    assert.strictEqual(result.stderr, '')
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})

test('Edit on a DOWNSTREAM root README.md (no template/) passes through — not canonical there', async () => {
  // A downstream fleet repo has no template/, so isCanonicalRelativePath
  // already returns false for its root README — the wheelhouse exemption is
  // not even reached, but the net effect (allowed) is the same. This pins
  // that a non-wheelhouse repo's README is never blocked by this path.
  const repo = makeFakeFleetRepo()
  try {
    const file = path.join(repo, 'README.md')
    writeFileSync(file, '# socket-foo\n')
    const result = await runHook({
      tool_input: { file_path: file, new_string: '# socket-foo (edited)' },
      tool_name: 'Edit',
    })
    assert.strictEqual(result.code, 0)
  } finally {
    rmSync(repo, { force: true, recursive: true })
  }
})
