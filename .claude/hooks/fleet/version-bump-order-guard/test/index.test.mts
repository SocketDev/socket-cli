import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

interface FakeRepo {
  readonly root: string
  cleanup(): void
}

function makeRepoWithHeadSubject(subject: string): FakeRepo {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bumporder-'))
  spawnSync('git', ['init', '-q'], { cwd: root })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  spawnSync('git', ['config', 'user.name', 'tester'], { cwd: root })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root })
  writeFileSync(path.join(root, 'README.md'), 'hi\n')
  spawnSync('git', ['add', '-A'], { cwd: root })
  spawnSync('git', ['commit', '-q', '-m', subject], { cwd: root })
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

// A bump-commit repo that ALSO declares a `lint` script — so the gate
// half runs. `lintExit` controls whether `pnpm run lint --all` passes
// (0) or fails (1): the lint script is a tiny node one-liner exiting that
// code, so the test doesn't depend on oxlint or a real toolchain.
function makeRepoWithLintScript(lintExit: number): FakeRepo {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bumporder-lint-'))
  spawnSync('git', ['init', '-q'], { cwd: root })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  spawnSync('git', ['config', 'user.name', 'tester'], { cwd: root })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root })
  // `pnpm run lint --all` forwards `--all` to the script. A bare
  // `node -e "…"` rejects `--all` as a node option, so the fixture lint
  // command points at a real script file: node treats the trailing
  // `--all` as a script argument (ignored), not a node flag.
  writeFileSync(
    path.join(root, 'lint-fixture.mjs'),
    `process.exit(${lintExit})\n`,
  )
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'gate-fixture',
      version: '1.2.3',
      scripts: { lint: 'node lint-fixture.mjs' },
    }),
  )
  spawnSync('git', ['add', '-A'], { cwd: root })
  spawnSync('git', ['commit', '-q', '-m', 'chore: bump version to 1.2.3'], {
    cwd: root,
  })
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function makeTranscript(userText?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bumporder-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({ role: 'user', content: userText ?? 'do it' }),
  )
  return transcriptPath
}

function runHook(
  command: string,
  cwd: string,
  transcriptPath?: string,
  extraEnv: Record<string, string> = {},
): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      transcript_path: transcriptPath,
      cwd,
    }),
    env: { ...process.env, ...extraEnv },
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

test('BLOCKS git tag vX.Y.Z when HEAD subject is not a bump', () => {
  const repo = makeRepoWithHeadSubject('feat: some random feature')
  try {
    const { stderr, exitCode } = runHook('git tag v1.2.3', repo.root)
    assert.equal(exitCode, 2)
    assert.match(stderr, /version-bump-order-guard/)
    assert.match(stderr, /feat: some random feature/)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS git tag vX.Y.Z when HEAD subject is "chore: bump version to X.Y.Z"', () => {
  const repo = makeRepoWithHeadSubject('chore: bump version to 1.2.3')
  try {
    const { exitCode } = runHook('git tag v1.2.3', repo.root)
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS git tag vX.Y.Z when HEAD subject is "chore(release): bump version to X.Y.Z"', () => {
  const repo = makeRepoWithHeadSubject('chore(release): bump version to 2.0.0')
  try {
    const { exitCode } = runHook('git tag v2.0.0', repo.root)
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS "chore: release X.Y.Z" subject', () => {
  const repo = makeRepoWithHeadSubject('chore: release 3.1.0')
  try {
    const { exitCode } = runHook('git tag v3.1.0', repo.root)
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('ALLOWS git tag with non-version label (no enforcement)', () => {
  const repo = makeRepoWithHeadSubject('feat: regular feature')
  try {
    const { exitCode } = runHook('git tag pre-release-snapshot', repo.root)
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('IGNORES non-Bash tools', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: { command: 'git tag v1.0.0' },
    }),
  })
  assert.equal(result.status, 0)
})

test('ALLOWS with bypass phrase', () => {
  const repo = makeRepoWithHeadSubject('feat: random commit')
  try {
    const t = makeTranscript('Allow version-bump-order bypass')
    const { exitCode } = runHook('git tag v1.0.0', repo.root, t)
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('fails open when not in a git repo', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bumporder-nogit-'))
  try {
    const { exitCode } = runHook('git tag v1.0.0', root)
    assert.equal(exitCode, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GATE BLOCKS a bump-commit tag when lint --all fails', () => {
  const repo = makeRepoWithLintScript(1)
  try {
    const { stderr, exitCode } = runHook('git tag v1.2.3', repo.root)
    assert.equal(exitCode, 2)
    assert.match(stderr, /Pre-release gate failed/)
    assert.match(stderr, /lint --all/)
  } finally {
    repo.cleanup()
  }
})

test('GATE ALLOWS a bump-commit tag when lint --all passes', () => {
  const repo = makeRepoWithLintScript(0)
  try {
    const { exitCode } = runHook('git tag v1.2.3', repo.root)
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})

test('SOCKET_VERSION_BUMP_SKIP_GATE=1 skips the gate (ordering still checked)', () => {
  const repo = makeRepoWithLintScript(1)
  try {
    const { exitCode } = runHook('git tag v1.2.3', repo.root, undefined, {
      SOCKET_VERSION_BUMP_SKIP_GATE: '1',
    })
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})
