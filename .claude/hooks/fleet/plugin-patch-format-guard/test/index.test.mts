// node --test specs for the plugin-patch-format-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { classifyPluginPatch, isPluginPatchPath } from '../index.mts'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
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

const PATCH_PATH =
  '/Users/x/projects/foo/scripts/plugin-patches/codex-1.0.1-stdin-eagain.patch'

const VALID_PATCH = `# @plugin: codex
# @plugin-version: 1.0.1
# @sha: 9cb4fe4099195b2587c402117a3efce6ab5aac78
# @upstream: https://github.com/openai/codex-plugin-cc
# @description: Fix EAGAIN on stdin read
#
--- a/scripts/lib/fs.mjs
+++ b/scripts/lib/fs.mjs
@@ -32,9 +32,39 @@
 context
-old
+new
 context
`

// --- Unit tests for the pure classifier. ---

test('classifyPluginPatch: valid patch passes', () => {
  const verdict = classifyPluginPatch(
    'codex-1.0.1-stdin-eagain.patch',
    VALID_PATCH,
  )
  assert.deepStrictEqual(verdict, { ok: true })
})

test('classifyPluginPatch: bad filename blocks', () => {
  for (const name of [
    'codex-1.0-x.patch', // version not dotted-semver
    'Codex-1.0.1-x.patch', // uppercase plugin
    'codex-1.0.1-X.patch', // uppercase slug
    'codex-1.0.1.patch', // missing slug
    'codex-1.0.1-x.diff', // wrong extension
  ]) {
    const verdict = classifyPluginPatch(name, VALID_PATCH)
    assert.strictEqual(verdict.ok, false, `${name} should be blocked`)
    if (!verdict.ok) {
      assert.match(verdict.reason, /<plugin>-<version>-<slug>\.patch/)
    }
  }
})

test('classifyPluginPatch: missing each required header key blocks', () => {
  const keys = ['@plugin', '@plugin-version', '@sha', '@description'] as const
  for (const key of keys) {
    // Drop just the line for `key`. Use a per-key version match for
    // @plugin-version so the cross-check doesn't pre-empt the header check.
    const content = VALID_PATCH.split('\n')
      .filter(line => !line.startsWith(`# ${key}:`))
      .join('\n')
    const verdict = classifyPluginPatch('codex-1.0.1-x.patch', content)
    assert.strictEqual(verdict.ok, false, `missing ${key} should block`)
    if (!verdict.ok) {
      assert.match(verdict.reason, /header/i)
    }
  }
})

test('classifyPluginPatch: git-diff markers block', () => {
  const gitDiffGit = VALID_PATCH.replace(
    '--- a/scripts/lib/fs.mjs',
    'diff --git a/scripts/lib/fs.mjs b/scripts/lib/fs.mjs\n--- a/scripts/lib/fs.mjs',
  )
  const v1 = classifyPluginPatch('codex-1.0.1-x.patch', gitDiffGit)
  assert.strictEqual(v1.ok, false)
  if (!v1.ok) {
    assert.match(v1.reason, /diff --git/)
  }

  const gitIndex = VALID_PATCH.replace(
    '--- a/scripts/lib/fs.mjs',
    'index ab12cd34..ef56ab78 100644\n--- a/scripts/lib/fs.mjs',
  )
  const v2 = classifyPluginPatch('codex-1.0.1-x.patch', gitIndex)
  assert.strictEqual(v2.ok, false)
  if (!v2.ok) {
    assert.match(v2.reason, /index/)
  }

  const gitNewFile = VALID_PATCH.replace(
    '--- a/scripts/lib/fs.mjs',
    'new file mode 100644\n--- a/scripts/lib/fs.mjs',
  )
  const v3 = classifyPluginPatch('codex-1.0.1-x.patch', gitNewFile)
  assert.strictEqual(v3.ok, false)
  if (!v3.ok) {
    assert.match(v3.reason, /new file mode/)
  }
})

test('classifyPluginPatch: missing diff body blocks', () => {
  const headerOnly = `# @plugin: codex
# @plugin-version: 1.0.1
# @sha: 9cb4fe4099195b2587c402117a3efce6ab5aac78
# @description: no diff body
#
`
  const verdict = classifyPluginPatch('codex-1.0.1-x.patch', headerOnly)
  assert.strictEqual(verdict.ok, false)
  if (!verdict.ok) {
    assert.match(verdict.reason, /--- /)
  }
})

test('classifyPluginPatch: version/filename mismatch blocks', () => {
  // Filename says 2.0.0, header says 1.0.1.
  const verdict = classifyPluginPatch('codex-2.0.0-x.patch', VALID_PATCH)
  assert.strictEqual(verdict.ok, false)
  if (!verdict.ok) {
    assert.match(verdict.reason, /mismatch/i)
  }
})

test('isPluginPatchPath: matches only scripts/plugin-patches/*.patch', () => {
  assert.strictEqual(isPluginPatchPath(PATCH_PATH), true)
  assert.strictEqual(
    isPluginPatchPath(
      '/Users/x/projects/foo/scripts/other/codex-1.0.1-x.patch',
    ),
    false,
  )
  assert.strictEqual(
    isPluginPatchPath('/Users/x/projects/foo/scripts/plugin-patches/notes.md'),
    false,
  )
})

// --- Integration tests through the hook subprocess. ---

test('hook: non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('hook: non-patch files pass through', async () => {
  const result = await runHook({
    tool_input: {
      content: 'export const X = 1',
      file_path: '/Users/x/projects/foo/src/index.mts',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('hook: valid patch via Write passes', async () => {
  const result = await runHook({
    tool_input: { content: VALID_PATCH, file_path: PATCH_PATH },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0, result.stderr)
})

test('hook: git-diff body via Write blocks', async () => {
  const gitDiff = VALID_PATCH.replace(
    '--- a/scripts/lib/fs.mjs',
    'diff --git a/scripts/lib/fs.mjs b/scripts/lib/fs.mjs\n--- a/scripts/lib/fs.mjs',
  )
  const result = await runHook({
    tool_input: { content: gitDiff, file_path: PATCH_PATH },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /plugin-patch-format-guard/)
  assert.match(result.stderr, /diff --git/)
})

test('hook: bad filename via Write blocks', async () => {
  const result = await runHook({
    tool_input: {
      content: VALID_PATCH,
      file_path:
        '/Users/x/projects/foo/scripts/plugin-patches/Codex-1.0-bad.patch',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /<plugin>-<version>-<slug>\.patch/)
})

test('hook: Edit without content is skipped (cannot see whole file)', async () => {
  const result = await runHook({
    tool_input: { file_path: PATCH_PATH, new_string: 'diff --git oops' },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
})

test('hook: Edit WITH content is validated', async () => {
  const gitDiff = VALID_PATCH.replace(
    '--- a/scripts/lib/fs.mjs',
    'diff --git a/scripts/lib/fs.mjs b/scripts/lib/fs.mjs\n--- a/scripts/lib/fs.mjs',
  )
  const result = await runHook({
    tool_input: { content: gitDiff, file_path: PATCH_PATH },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
})

test('hook: relative plugin-patch path blocks (PreToolUse always passes absolute)', async () => {
  const result = await runHook({
    tool_input: {
      content: VALID_PATCH,
      file_path: 'scripts/plugin-patches/codex-1.0.1-stdin-eagain.patch',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /must be absolute/)
})
