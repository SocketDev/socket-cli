// node --test specs for the claude-segmentation-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

interface Result {
  readonly code: number
  readonly stderr: string
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
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

function edit(filePath: string): Record<string, unknown> {
  return { tool_input: { file_path: filePath }, tool_name: 'Edit' }
}

function write(filePath: string): Record<string, unknown> {
  return { tool_input: { file_path: filePath }, tool_name: 'Write' }
}

test('non-Edit/Write tool calls pass through', async () => {
  const r = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('empty / unparseable payload passes through', async () => {
  assert.strictEqual((await runHook({})).code, 0)
})

test('paths outside .claude/ pass through', async () => {
  for (const p of [
    'src/index.ts',
    'docs/claude.md/fleet/topic.md',
    'README.md',
    'package.json',
  ]) {
    assert.strictEqual((await runHook(edit(p))).code, 0, `expected pass for ${p}`)
  }
})

test('blocks dangling skill at .claude/skills/<name>/SKILL.md', async () => {
  const r = await runHook(edit('.claude/skills/foo/SKILL.md'))
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /claude-segmentation-guard/)
  assert.match(r.stderr, /skills\/foo/)
  assert.match(r.stderr, /fleet\/foo/)
  assert.match(r.stderr, /repo\/foo/)
  assert.match(r.stderr, /--fix/)
})

test('blocks dangling agent at .claude/agents/<name>.md', async () => {
  const r = await runHook(edit('.claude/agents/code-reviewer.md'))
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /agents\/code-reviewer/)
})

test('blocks dangling hook at .claude/hooks/<name>/index.mts', async () => {
  const r = await runHook(write('.claude/hooks/my-guard/index.mts'))
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /hooks\/my-guard/)
})

test('blocks dangling command at .claude/commands/<name>.md', async () => {
  const r = await runHook(write('.claude/commands/foo.md'))
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /commands\/foo/)
})

test('passes .claude/<kind>/fleet/<name>/ paths', async () => {
  for (const p of [
    '.claude/skills/fleet/foo/SKILL.md',
    '.claude/agents/fleet/security-reviewer.md',
    '.claude/commands/fleet/quality-loop.md',
    '.claude/hooks/fleet/my-guard/index.mts',
  ]) {
    const r = await runHook(edit(p))
    assert.strictEqual(r.code, 0, `expected pass for ${p}, got stderr: ${r.stderr}`)
  }
})

test('passes .claude/<kind>/repo/<name>/ paths', async () => {
  for (const p of [
    '.claude/skills/repo/foo/SKILL.md',
    '.claude/agents/repo/code-reviewer.md',
    '.claude/commands/repo/update-something.md',
    '.claude/hooks/repo/local-only/index.mts',
  ]) {
    const r = await runHook(edit(p))
    assert.strictEqual(r.code, 0, `expected pass for ${p}, got stderr: ${r.stderr}`)
  }
})

test('passes _-prefixed internals folder paths', async () => {
  for (const p of [
    '.claude/skills/_shared/util.mts',
    '.claude/skills/_internal/x.mts',
    '.claude/hooks/_shared/foreign-paths.mts',
    '.claude/hooks/_shared/test/foo.test.mts',
  ]) {
    const r = await runHook(edit(p))
    assert.strictEqual(r.code, 0, `expected pass for ${p}, got stderr: ${r.stderr}`)
  }
})

test('blocks under wheelhouse template/.claude/<kind>/<name>/ too', async () => {
  // The cascade ships everything under template/.claude/<kind>/fleet/
  // so a dangling template entry breaks every downstream repo. Same
  // rule applies there.
  const r = await runHook(edit('template/.claude/skills/foo/SKILL.md'))
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /skills\/foo/)
})

test('passes paths that mention .claude/ but not as a directory prefix', async () => {
  // The regex anchors on `.claude/<kind>/`, so a string-literal mention
  // inside an unrelated file doesn't match.
  const r = await runHook(edit('docs/notes.md'))
  assert.strictEqual(r.code, 0)
})

test('passes when tool_input has no file_path', async () => {
  const r = await runHook({ tool_input: {}, tool_name: 'Edit' })
  assert.strictEqual(r.code, 0)
})

test('passes for absolute paths under fleet/', async () => {
  const r = await runHook(edit('/tmp/fake-repo/.claude/skills/fleet/bar/SKILL.md'))
  assert.strictEqual(r.code, 0)
})

test('blocks absolute paths to a dangling top-level entry', async () => {
  const r = await runHook(edit('/tmp/fake-repo/.claude/skills/bar/SKILL.md'))
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /skills\/bar/)
})
