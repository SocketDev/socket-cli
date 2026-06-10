// node --test specs for .git-hooks/pre-push.mts.
//
// Smoke tests: spin up a temp git repo, commit content, feed a
// push-line to the hook over stdin, inspect exit code. Covers the
// AI-attribution block path and the secret-leak block path.

// Side-effect import FIRST: strip inherited git discovery vars so this
// fixture's git ops resolve from its own cwd and can't escape onto the live
// .git/config (core.bare / test-identity leak). node:test skips vitest setup.
import '../../_shared/isolate-git-env.mts'

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'pre-push.mts')

const ZERO_SHA = '0000000000000000000000000000000000000000'

// `nestUnder` places the repo at `<tmp>/<nestUnder>/repo` so its
// `git rev-parse --show-toplevel` path contains that segment — used to exercise
// the fast-check tier's skip when the checkout lives under an ignored dir
// (`.claude/worktrees/…`).
function setupRepo(nestUnder?: string): string {
  const base = mkdtempSync(path.join(os.tmpdir(), 'pre-push-test-'))
  const dir = nestUnder ? path.join(base, nestUnder, 'repo') : base
  if (nestUnder) {
    mkdirSync(dir, { recursive: true })
  }
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  // Create a baseline commit and an `origin/main` remote-tracking ref
  // pointing at it. The hook's range computation requires a baseline
  // — without one, it skips validation entirely (treats the push as
  // a brand-new branch with no baseline to diff against).
  writeFileSync(path.join(dir, '.gitkeep'), '')
  spawnSync('git', ['add', '.gitkeep'], { cwd: dir })
  spawnSync('git', ['commit', '-q', '-m', 'baseline', '--no-verify'], {
    cwd: dir,
  })
  // Manually create the remote-tracking ref so computeRange has a
  // baseline. spawnSync('update-ref') is a low-level git plumbing call
  // that bypasses the network.
  const baseSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir })
    .stdout.toString()
    .trim()
  spawnSync('git', ['update-ref', 'refs/remotes/origin/main', baseSha], {
    cwd: dir,
  })
  spawnSync(
    'git',
    ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
    { cwd: dir },
  )
  return dir
}

function commit(
  dir: string,
  file: string,
  content: string,
  msg: string,
): string {
  writeFileSync(path.join(dir, file), content)
  spawnSync('git', ['add', file], { cwd: dir })
  spawnSync('git', ['commit', '-q', '-m', msg, '--no-verify'], { cwd: dir })
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir })
  return r.stdout.toString().trim()
}

async function runHook(
  cwd: string,
  pushLine: string,
): Promise<{ code: number; stderr: string }> {
  const child = spawn(process.execPath, [HOOK, 'origin', cwd], {
    cwd,
    stdio: 'pipe',
  })
  // The fleet `spawn` returns `{ process } & Promise<{ code, stderr, … }>`; the
  // real ChildProcess (for stdin) is `child.process`, and the wrapper REJECTS
  // on a non-zero exit with an error carrying `.code` + `.stderr`. Write the
  // push line to stdin, then await — treating a rejection as the hook's exit
  // result so the blocking (code 1) cases are observable.
  child.process.stdin?.end(pushLine)
  try {
    const result = await child
    return {
      code: typeof result.code === 'number' ? result.code : 0,
      stderr: String(result.stderr ?? ''),
    }
  } catch (e) {
    const err = e as { code?: number | undefined; stderr?: unknown }
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stderr: String(err.stderr ?? ''),
    }
  }
}

test('pre-push: empty stdin exits 0 (nothing to push)', async () => {
  const dir = setupRepo()
  try {
    const { code } = await runHook(dir, '')
    assert.strictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: clean commit + clean message passes', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'feat: initial commit',
    )
    // Push to a topic branch — the signed-commit check exempts non-main
    // refs since these test cases aren't about signing.
    const pushLine = `refs/heads/topic ${sha} refs/heads/topic ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.strictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: fast-check tier skips a repo with no `lint` script', async () => {
  // The clean-push case above already has no package.json lint script and
  // passes — this asserts the skip is intentional: a repo that doesn't lint
  // isn't blocked by the fast-check tier.
  const dir = setupRepo()
  try {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { build: 'true' } }),
    )
    const sha = commit(dir, 'foo.ts', 'export const X = 1\n', 'feat: add x')
    const pushLine = `refs/heads/topic ${sha} refs/heads/topic ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.strictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: fast-check tier blocks when the lint runner exits non-zero', async () => {
  const dir = setupRepo()
  try {
    // The tier invokes the `lint` script's `node <path>` runner directly. A
    // runner that exits 1 stands in for a real lint/format failure; the tier
    // must block the push on it.
    writeFileSync(path.join(dir, 'lint.mjs'), 'process.exit(1)\n')
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { lint: 'node lint.mjs' } }),
    )
    const sha = commit(dir, 'foo.ts', 'export const X = 1\n', 'feat: add x')
    const pushLine = `refs/heads/topic ${sha} refs/heads/topic ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.strictEqual(code, 1)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: fast-check tier skips when the checkout is under .claude/', async () => {
  // A linked worktree under `.claude/worktrees/…` makes the formatter's
  // `**/.claude/**` ignore match the checkout's own path ancestor, excluding
  // every file ("Expected at least one target file"). The tier detects a
  // toplevel under `.claude/` and skips (CI re-lints from a clean tree) rather
  // than false-block. A failing lint runner here must NOT block the push.
  const dir = setupRepo(path.join('.claude', 'worktrees', 'wt'))
  try {
    writeFileSync(path.join(dir, 'lint.mjs'), 'process.exit(1)\n')
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { lint: 'node lint.mjs' } }),
    )
    const sha = commit(dir, 'foo.ts', 'export const X = 1\n', 'feat: add x')
    const pushLine = `refs/heads/topic ${sha} refs/heads/topic ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    // Skipped, not blocked — even though the lint runner would exit 1.
    assert.strictEqual(code, 0)
  } finally {
    // dir is `<tmp>/.claude/worktrees/wt/repo`; remove the tmp base.
    rmSync(path.join(dir, '..', '..', '..', '..'), {
      force: true,
      recursive: true,
    })
  }
})

test("pre-push: fast-check tier skips a non-node lint script (can't run safely)", async () => {
  // A `lint` script that isn't `node <path>` (e.g. shells out to a tool) is
  // skipped — running it directly isn't safe without pnpm; CI covers it.
  const dir = setupRepo()
  try {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { lint: 'eslint .' } }),
    )
    const sha = commit(dir, 'foo.ts', 'export const X = 1\n', 'feat: add x')
    const pushLine = `refs/heads/topic ${sha} refs/heads/topic ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.strictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: blocks commit with AI-attribution body', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'feat: ship feature\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
    )
    const pushLine = `refs/heads/main ${sha} refs/heads/main ${ZERO_SHA}\n`
    const { code, stderr } = await runHook(dir, pushLine)
    assert.notStrictEqual(code, 0, 'AI attribution must block push')
    assert.match(stderr, /AI attribution|Co-Authored-By/i)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: keeps prose mentioning Claude in context', async () => {
  // The previous regex matched bare "Claude Code" — verify the fix
  // doesn't false-positive on legitimate references.
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'docs(claude): point at Claude Code best practices\n\nLinks the upstream guide that informs the .claude/ layout.',
    )
    // Topic branch — the signed-commit check exempts non-main refs.
    const pushLine = `refs/heads/topic ${sha} refs/heads/topic ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.strictEqual(code, 0, 'legitimate Claude Code prose must pass')
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: blocks commit introducing a personal-path leak', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'leak.ts',
      'export const HOME = "/Users/jdalton/secret"\n',
      'feat: add config',
    )
    const pushLine = `refs/heads/main ${sha} refs/heads/main ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.notStrictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: unsigned commit pushed to main is blocked', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'feat: clean commit',
    )
    // Pushing to refs/heads/main with unsigned commits → block.
    const pushLine = `refs/heads/main ${sha} refs/heads/main ${ZERO_SHA}\n`
    const { code, stderr } = await runHook(dir, pushLine)
    assert.notStrictEqual(code, 0, 'unsigned push to main must block')
    assert.match(stderr, /unsigned commit/i)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: unsigned commit pushed to master is blocked', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'feat: clean commit',
    )
    const pushLine = `refs/heads/master ${sha} refs/heads/master ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.notStrictEqual(code, 0, 'unsigned push to master must block')
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: unsigned commit pushed to topic branch is allowed', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'feat: clean commit',
    )
    const pushLine = `refs/heads/feature ${sha} refs/heads/feature ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.strictEqual(
      code,
      0,
      'topic branch push exempt from signed-commit gate',
    )
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: SOCKET_PRE_PUSH_ALLOW_UNSIGNED env var no longer bypasses the check', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'feat: emergency push',
    )
    const pushLine = `refs/heads/main ${sha} refs/heads/main ${ZERO_SHA}\n`
    const child = spawn(process.execPath, [HOOK, 'origin', dir], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env, SOCKET_PRE_PUSH_ALLOW_UNSIGNED: '1' },
    })
    // Lib `spawn`: stdin is on `child.process`; the wrapper rejects on a
    // non-zero exit with an error carrying `.code`.
    child.process.stdin?.end(pushLine)
    let code: number
    try {
      code = (await child).code ?? 0
    } catch (e) {
      code = (e as { code?: number | undefined }).code ?? 1
    }
    assert.notStrictEqual(
      code,
      0,
      'unsigned push is always blocked — no bypass exists',
    )
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})
