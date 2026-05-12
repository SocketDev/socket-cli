// node --test specs for the no-revert-guard hook.
//
// Spawns the hook as a subprocess (matches the production runtime),
// pipes a JSON payload on stdin, captures stderr + exit code.

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
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
    const dir = mkdtempSync(path.join(tmpdir(), 'no-revert-guard-test-'))
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

test('DISABLE_PRECOMMIT_LINT=1 is blocked without phrase', async () => {
  const result = await runHook({
    tool_input: { command: 'DISABLE_PRECOMMIT_LINT=1 git commit -m "foo"' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow lint bypass/)
})

test('DISABLE_PRECOMMIT_LINT=1 allowed with phrase', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'DISABLE_PRECOMMIT_LINT=1 git commit -m "foo"' },
      tool_name: 'Bash',
    },
    userTurn('Allow lint bypass — manual cleanup follows'),
  )
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

test('git push --force is blocked', async () => {
  const result = await runHook({
    tool_input: { command: 'git push --force origin main' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Allow force-push bypass/)
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

test('case mismatch does not count', async () => {
  const result = await runHook(
    {
      tool_input: { command: 'git checkout -- src/foo.ts' },
      tool_name: 'Bash',
    },
    userTurn('allow revert bypass'),
  )
  assert.strictEqual(result.code, 2)
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
