// node --test specs for the no-revert-guard hook.
//
// Spawns the hook as a subprocess (matches the production runtime),
// pipes a JSON payload on stdin, captures stderr + exit code.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
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

async function runHook(
  payload: Record<string, unknown>,
  transcript?: string,
): Promise<Result> {
  let transcriptPath: string | undefined
  if (transcript !== undefined) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'no-revert-guard-test-'))
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
  return JSON.stringify({ type: 'user', message: { content: text } }) + '\n'
}

test('non-Bash tool calls pass through untouched', async () => {
  const result = await runHook({
    tool_input: { file_path: 'foo.ts', new_string: 'export const x = 1' },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('benign git command (status) passes through', async () => {
  const result = await runHook({
    tool_input: { command: 'git status --short' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('git checkout -- <file> is blocked without phrase', async () => {
  const result = await runHook({
    tool_input: { command: 'git checkout -- src/foo.ts' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-revert-guard/)
  assert.match(result.stderr, /Allow revert bypass/)
})

test('git checkout -- <file> is allowed with phrase', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git checkout -- src/foo.ts' },
      tool_name: 'Bash',
    },
    userTurn('Allow revert bypass — please revert that one file'),
  )
  assert.strictEqual(result.code, 0)
})

test('git reset --hard is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git reset --hard HEAD~1' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow revert bypass/)
})

test('git restore <file> is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git restore src/foo.ts' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('git restore --staged <file> is allowed (unstages, no revert)', async () => {
  const result = await runHook({
    tool_input: { command: 'git restore --staged src/foo.ts' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('git stash drop is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git stash drop' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('--no-verify is blocked without its specific phrase', async () => {
  const result = await runHook({
    tool_input: { command: 'git commit -m "foo" --no-verify' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow no-verify bypass/)
})

test('--no-verify is allowed with its phrase', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git commit -m "foo" --no-verify' },
      tool_name: 'Bash',
    },
    userTurn('Allow no-verify bypass for the next commit'),
  )
  assert.strictEqual(result.code, 0)
})

test('git rebase --no-verify is allowed without bypass phrase', async () => {
  // Rebase replays existing commits; their pre-commit hooks already ran
  // when the commits were first authored. Re-running them during replay
  // would either no-op or mutate content (autofix → diverged commit).
  // Both waste work and break intent — the policy is exempt for rebase.
  const result = await runHook({
    tool_input: { command: 'git rebase --no-verify origin/main' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('git rebase -i --no-verify is allowed without bypass phrase', async () => {
  // Same exemption applies to interactive rebases (the common case
  // for reordering / squashing).
  const result = await runHook({
    tool_input: { command: 'git rebase -i HEAD~3 --no-verify' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('git push --no-verify is still blocked even alongside rebase', async () => {
  // A chained command with `git rebase --no-verify && git push --no-verify`
  // must still block on the push — the rebase exemption is per-invocation,
  // not a free pass for the whole shell line.
  const result = await runHook({
    tool_input: {
      command: 'git rebase --no-verify HEAD~2 && git push --no-verify',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow no-verify bypass/)
})

test('DISABLE_PRECOMMIT_LINT=1 is no longer a recognized bypass (env knob removed)', async () => {
  const result = await runHook({
    tool_input: { command: 'DISABLE_PRECOMMIT_LINT=1 git commit -m "foo"' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('DISABLE_PRECOMMIT_TEST=1 is no longer a recognized bypass (env knob removed)', async () => {
  const result = await runHook({
    tool_input: { command: 'DISABLE_PRECOMMIT_TEST=1 git commit -m "foo"' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('SKIP_ASSET_DOWNLOAD=1 is blocked without phrase', async () => {
  const result = await runHook({
    tool_input: { command: 'SKIP_ASSET_DOWNLOAD=1 pnpm run build' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow asset-download bypass/)
})

test('SKIP_ASSET_DOWNLOAD=1 allowed with phrase', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'SKIP_ASSET_DOWNLOAD=1 pnpm run build' },
      tool_name: 'Bash',
    },
    userTurn('Allow asset-download bypass — GitHub releases rate-limited'),
  )
  assert.strictEqual(result.code, 0)
})

test('bare git stash is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git stash' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow stash bypass/)
})

test('git stash --keep-index is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git stash --keep-index' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow stash bypass/)
})

test('git stash push is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git stash push -m "test"' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow stash bypass/)
})

test('git stash is allowed with phrase', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git stash --keep-index' },
      tool_name: 'Bash',
    },
    userTurn('Allow stash bypass — single Claude session, safe'),
  )
  assert.strictEqual(result.code, 0)
})

test('git stash drop is blocked by the revert check, not the stash check', async () => {
  const result = await runHook({
    tool_input: { command: 'git stash drop stash@{0}' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow revert bypass/)
})

test('python -c with open(...,"w") is blocked', async () => {
  const result = await runHook({
    tool_input: {
      command: `python3 -c 'open("docs/file.md","w").write("content")'`,
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow bash-write bypass/)
})

test('python -c with .write_text is blocked', async () => {
  const result = await runHook({
    tool_input: {
      command: `python3 -c 'import pathlib; pathlib.Path("foo.md").write_text("x")'`,
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow bash-write bypass/)
})

test('sed -i is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'sed -i "s/foo/bar/g" src/file.ts' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow bash-write bypass/)
})

test('heredoc redirected to source file is blocked', async () => {
  const result = await runHook({
    tool_input: {
      command: `cat << EOF > src/foo.ts\nexport const x = 1\nEOF`,
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow bash-write bypass/)
})

test('dd of= is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'dd if=/dev/zero of=src/blob.bin bs=1024 count=1' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow bash-write bypass/)
})

test('tee writing to a source file is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'echo "x" | tee src/foo.ts' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow bash-write bypass/)
})

test('bash-write is allowed with phrase', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'sed -i "s/foo/bar/g" build/generated.json' },
      tool_name: 'Bash',
    },
    userTurn('Allow bash-write bypass — generated file, no Edit hook needed'),
  )
  assert.strictEqual(result.code, 0)
})

test('mv is NOT a bash-write (file move, not content write)', async () => {
  const result = await runHook({
    tool_input: { command: 'mv src/old.ts src/new.ts' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('cp is NOT a bash-write', async () => {
  const result = await runHook({
    tool_input: { command: 'cp template/x.json downstream/x.json' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('python -c without file write is NOT blocked', async () => {
  const result = await runHook({
    tool_input: { command: `python3 -c 'print("hello")'` },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('git push --force is blocked, needs the hard phrase', async () => {
  const result = await runHook({
    tool_input: { command: 'git push --force origin main' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow force-push-hard bypass/)
})

test('bare --force is NOT authorized by the lease phrase', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git push --force origin main' },
      tool_name: 'Bash',
    },
    userTurn('Allow force-with-lease bypass'),
  )
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow force-push-hard bypass/)
})

test('paraphrase does not count', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git checkout -- src/foo.ts' },
      tool_name: 'Bash',
    },
    userTurn('go ahead and revert that file'),
  )
  assert.strictEqual(result.code, 2)
})

test('bypass phrase is case-insensitive', async () => {
  // normalizeBypassText() lowercases both sides before comparing — typing
  // the phrase is already a deliberate act, casing carries no extra
  // signal, and requiring exact case just trips up a hurried user.
  const result = await runHook(
    {
      tool_input: { command: 'git checkout -- src/foo.ts' },
      tool_name: 'Bash',
    },
    userTurn('allow revert bypass'),
  )
  assert.strictEqual(result.code, 0)
})

test('bypass phrase tolerates SHOUTING', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git checkout -- src/foo.ts' },
      tool_name: 'Bash',
    },
    userTurn('ALLOW REVERT BYPASS'),
  )
  assert.strictEqual(result.code, 0)
})

test('multi-line user turn with phrase embedded works', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git checkout -- src/foo.ts' },
      tool_name: 'Bash',
    },
    userTurn(
      'I want to drop my last edit.\nAllow revert bypass\nThat one specifically.',
    ),
  )
  assert.strictEqual(result.code, 0)
})

// ── FLEET_SYNC=1 cascade allowlist ──────────────────────────────────

test('FLEET_SYNC=1 allows the cascade commit without bypass phrase', async () => {
  const result = await runHook({
    tool_input: {
      command:
        'FLEET_SYNC=1 git commit --no-verify -m "chore(wheelhouse): cascade template@abc1234"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('FLEET_SYNC=1 allows the cascade push without bypass phrase', async () => {
  const result = await runHook({
    tool_input: {
      command: 'FLEET_SYNC=1 git push --no-verify origin HEAD:main',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('FLEET_SYNC=1 with a non-cascade commit message is still blocked', async () => {
  const result = await runHook({
    tool_input: {
      command: 'FLEET_SYNC=1 git commit --no-verify -m "feat: sneak this past"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.ok(String(result.stderr).includes('Allow no-verify bypass'))
})

test('FLEET_SYNC=1 does NOT relax non-git destructive ops (e.g. stash)', async () => {
  const result = await runHook({
    tool_input: { command: 'FLEET_SYNC=1 git stash' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.ok(String(result.stderr).includes('Allow stash bypass'))
})

test('FLEET_SYNC=1 does NOT relax git reset --hard', async () => {
  const result = await runHook({
    tool_input: { command: 'FLEET_SYNC=1 git reset --hard HEAD~1' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.ok(String(result.stderr).includes('Allow revert bypass'))
})

test('no FLEET_SYNC sentinel: cascade commit still requires the bypass phrase', async () => {
  const result = await runHook({
    tool_input: {
      command:
        'git commit --no-verify -m "chore(wheelhouse): cascade template@abc1234"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.ok(String(result.stderr).includes('Allow no-verify bypass'))
})

test('FLEET_SYNC=0 (explicit off) does NOT activate the allowlist', async () => {
  const result = await runHook({
    tool_input: {
      command:
        'FLEET_SYNC=0 git commit --no-verify -m "chore(wheelhouse): cascade template@abc1234"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.ok(String(result.stderr).includes('Allow no-verify bypass'))
})

// ── Parser-enabled coverage (added with the shell-quote migration) ──

test('destructive git in an && chain is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'echo backup && git reset --hard origin/main' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('destructive git after a cd is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'cd /repo; git clean -fdx' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('quoted "git reset --hard" in a commit message is NOT a revert', async () => {
  const result = await runHook({
    tool_input: {
      command: 'git commit -m "document why git reset --hard is dangerous"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('quoted "git push --force" in an echo is NOT a force-push', async () => {
  const result = await runHook({
    tool_input: { command: 'echo "never git push --force to main"' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('git clean -f is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git clean -f' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('git clean -xdf (bundled flags) is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git clean -xdf' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('git rm -rf is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git rm -rf old-dir' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('git checkout <ref> -- <path> is blocked (ref form)', async () => {
  const result = await runHook({
    tool_input: { command: 'git checkout HEAD~1 -- src/foo.ts' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('git push --force-with-lease is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git push --force-with-lease origin main' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('--force-with-lease allowed by its own phrase', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git push --force-with-lease origin main' },
      tool_name: 'Bash',
    },
    userTurn('Allow force-with-lease bypass'),
  )
  assert.strictEqual(result.code, 0)
})

test('--force-with-lease ALSO allowed by the stronger force-push phrase', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git push --force-with-lease origin main' },
      tool_name: 'Bash',
    },
    userTurn('Allow force-push bypass'),
  )
  assert.strictEqual(result.code, 0)
})

test('git push -f is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git push -f origin main' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('plain git push (no force) is NOT blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git push origin main' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('git checkout <branch> (switch, no --) is NOT a revert', async () => {
  const result = await runHook({
    tool_input: { command: 'git checkout main' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('git reset (soft, default) is NOT blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git reset HEAD~1' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('git stash pop attributed to the revert rule (not stash rule)', async () => {
  const result = await runHook({
    tool_input: { command: 'git stash pop' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow revert bypass/)
})

test('a word ending in "git" is not a git command (e.g. legit)', async () => {
  const result = await runHook({
    tool_input: { command: 'echo legit && ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

// ── SQUASH_HISTORY=1 sentinel (squashing-history skill) ──
//
// The sentinel authorizes exactly the two squash operations and nothing
// else. The rejection tests below are the malicious-bypass surface: a
// poisoned prompt must NOT be able to ride the sentinel to clobber an
// arbitrary remote, delete refs, or chain extra destructive work.

test('SQUASH_HISTORY=1 allows the squash collapse commit (--amend, exact message)', async () => {
  const result = await runHook({
    tool_input: {
      command: 'SQUASH_HISTORY=1 git commit --amend -m "chore: initial commit"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('SQUASH_HISTORY=1 allows the squash force-push (--force-with-lease)', async () => {
  const result = await runHook({
    tool_input: {
      command: 'SQUASH_HISTORY=1 git push --force-with-lease origin main',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('SQUASH_HISTORY=1 allows the squash force-push (bare --force)', async () => {
  const result = await runHook({
    tool_input: {
      command: 'SQUASH_HISTORY=1 git push --force origin master',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('SQUASH_HISTORY=1 does NOT grant the bypass on a wrong-message amend', async () => {
  // A wrong commit message means the sentinel does not fire. To prove the
  // sentinel (not benign-ness) is what's withheld, pair the wrong message
  // with `--no-verify`: that flag MUST still be blocked because the sentinel
  // refused to authorize this shape.
  const result = await runHook({
    tool_input: {
      command:
        'SQUASH_HISTORY=1 git commit --amend --no-verify -m "feat: sneak this past the guard"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow no-verify bypass/)
})

test('SQUASH_HISTORY=1 does NOT allow a commit without --amend', async () => {
  const result = await runHook({
    tool_input: {
      command:
        'SQUASH_HISTORY=1 git commit --no-verify -m "chore: initial commit"',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow no-verify bypass/)
})

test('SQUASH_HISTORY=1 does NOT allow chaining a destructive command (&&)', async () => {
  const result = await runHook({
    tool_input: {
      command:
        'SQUASH_HISTORY=1 git push --force origin main && rm -rf /important',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('SQUASH_HISTORY=1 does NOT allow chaining a destructive git op (;)', async () => {
  const result = await runHook({
    tool_input: {
      command:
        'SQUASH_HISTORY=1 git commit --amend -m "chore: initial commit"; git reset --hard origin/main',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('SQUASH_HISTORY=1 does NOT allow a command substitution', async () => {
  const result = await runHook({
    tool_input: {
      command: 'SQUASH_HISTORY=1 git push --force origin $(cat /tmp/evil-ref)',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('SQUASH_HISTORY=1 does NOT allow a refspec push (src:dst)', async () => {
  const result = await runHook({
    tool_input: {
      command: 'SQUASH_HISTORY=1 git push --force origin main:production',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('SQUASH_HISTORY=1 does NOT allow a branch-delete push', async () => {
  const result = await runHook({
    tool_input: {
      command: 'SQUASH_HISTORY=1 git push --force --delete origin main',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('SQUASH_HISTORY=1 does NOT allow --mirror push', async () => {
  const result = await runHook({
    tool_input: {
      command: 'SQUASH_HISTORY=1 git push --force --mirror origin',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('SQUASH_HISTORY=1 does NOT allow an extra inline env assignment', async () => {
  const result = await runHook({
    tool_input: {
      command:
        'SQUASH_HISTORY=1 GIT_SSH_COMMAND="ssh -i /tmp/evil" git push --force origin main',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('SQUASH_HISTORY=1 does NOT relax an unrelated destructive op (stash)', async () => {
  const result = await runHook({
    tool_input: { command: 'SQUASH_HISTORY=1 git stash drop' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('SQUASH_HISTORY=1 does NOT relax git reset --hard', async () => {
  const result = await runHook({
    tool_input: { command: 'SQUASH_HISTORY=1 git reset --hard HEAD~1' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow revert bypass/)
})

test('SQUASH_HISTORY=0 (explicit off) does NOT activate the allowlist', async () => {
  const result = await runHook({
    tool_input: {
      command: 'SQUASH_HISTORY=0 git push --force origin main',
    },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
})

test('no SQUASH_HISTORY sentinel: the squash push still requires a phrase', async () => {
  const result = await runHook({
    tool_input: { command: 'git push --force origin main' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow force-push-hard bypass/)
})
