// node --test specs for the markdown-filename-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
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

test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('non-markdown files pass through', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/src/SHOUTY.ts',
      new_string: 'export const X = 1',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
})

test('README.md anywhere is allowed', async () => {
  for (const p of [
    '/Users/x/projects/foo/README.md',
    '/Users/x/projects/foo/packages/bar/README.md',
    '/Users/x/projects/foo/docs/sub/README.md',
  ]) {
    const result = await runHook({
      tool_input: { content: 'hi', file_path: p },
      tool_name: 'Write',
    })
    assert.strictEqual(result.code, 0, p)
  }
})

test('LICENSE anywhere is allowed', async () => {
  const result = await runHook({
    tool_input: { content: 'MIT', file_path: '/Users/x/projects/foo/LICENSE' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('CLAUDE.md at root is allowed', async () => {
  const result = await runHook({
    tool_input: {
      content: '# CLAUDE.md',
      file_path: '/Users/x/projects/foo/CLAUDE.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('CLAUDE.md under socket-wheelhouse/template/ is allowed (template-as-root carve-out)', async () => {
  const result = await runHook({
    tool_input: {
      content: '# CLAUDE.md',
      file_path: '/Users/x/projects/socket-wheelhouse/template/CLAUDE.md',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
})

test('CLAUDE.md under template/docs/ is allowed (template-as-root + docs/)', async () => {
  const result = await runHook({
    tool_input: {
      content: '# CLAUDE.md',
      file_path: '/Users/x/projects/socket-wheelhouse/template/docs/CLAUDE.md',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
})

test('CLAUDE.md deeper under template/ (template/packages/foo/) is still blocked', async () => {
  const result = await runHook({
    tool_input: {
      content: '# CLAUDE.md',
      file_path:
        '/Users/x/projects/socket-wheelhouse/template/packages/foo/CLAUDE.md',
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /SCREAMING_CASE/)
})

test('CONTRIBUTING.md at root is allowed', async () => {
  const result = await runHook({
    tool_input: {
      content: 'how to contribute',
      file_path: '/Users/x/projects/foo/CONTRIBUTING.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('CONTRIBUTING.md in docs/ is allowed', async () => {
  const result = await runHook({
    tool_input: {
      content: 'how to contribute',
      file_path: '/Users/x/projects/foo/docs/CONTRIBUTING.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('CONTRIBUTING.md in docs/sub/ is blocked', async () => {
  const result = await runHook({
    tool_input: {
      content: 'how to contribute',
      file_path: '/Users/x/projects/foo/docs/sub/CONTRIBUTING.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /SCREAMING_CASE/)
})

test('NOTES.md (non-allowlisted SCREAMING_CASE) is blocked', async () => {
  const result = await runHook({
    tool_input: {
      content: 'notes',
      file_path: '/Users/x/projects/foo/docs/NOTES.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /SCREAMING_CASE markdown filenames/)
  assert.match(result.stderr, /notes\.md/)
})

test('MY_DESIGN.md (custom SCREAMING_CASE) is blocked', async () => {
  const result = await runHook({
    tool_input: {
      content: 'design',
      file_path: '/Users/x/projects/foo/docs/MY_DESIGN.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /my-design\.md/)
})

test('lowercase-with-hyphens in docs/ is allowed', async () => {
  const result = await runHook({
    tool_input: {
      content: 'doc',
      file_path: '/Users/x/projects/foo/docs/release-notes.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('lowercase-with-hyphens at root is blocked', async () => {
  const result = await runHook({
    tool_input: {
      content: 'doc',
      file_path: '/Users/x/projects/foo/release-notes.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /docs\/ or \.claude\//)
})

test('camelCase markdown filename is blocked', async () => {
  const result = await runHook({
    tool_input: {
      content: 'doc',
      file_path: '/Users/x/projects/foo/docs/myDoc.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /lowercase-with-hyphens/)
})

test('underscore in lowercase doc is blocked', async () => {
  const result = await runHook({
    tool_input: {
      content: 'doc',
      file_path: '/Users/x/projects/foo/docs/my_doc.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('.MD extension is blocked', async () => {
  const result = await runHook({
    tool_input: {
      content: 'doc',
      file_path: '/Users/x/projects/foo/docs/release-notes.MD',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /\.md/)
})

test('<source-filename>.md (code-file hint) is allowed under docs/', async () => {
  const result = await runHook({
    tool_input: {
      content: 'doc',
      file_path: '/Users/x/projects/foo/docs/additions/lib/smol-ffi.js.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('<source-filename>.md works for .mts / .cc / .py too', async () => {
  for (const filename of ['parser.mts.md', 'binding.cc.md', 'tool.py.md']) {
    const result = await runHook({
      tool_input: {
        content: 'doc',
        file_path: `/Users/x/projects/foo/docs/${filename}`,
      },
      tool_name: 'Write',
    })
    assert.strictEqual(
      result.code,
      0,
      `${filename} should be allowed (got code ${result.code}: ${result.stderr})`,
    )
  }
})

test('<source-filename>.md with non-hyphenated stem is still blocked', async () => {
  // `bad_name.js.md` strips to `bad_name`, which is not lowercase-hyphenated.
  const result = await runHook({
    tool_input: {
      content: 'doc',
      file_path: '/Users/x/projects/foo/docs/bad_name.js.md',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /lowercase-with-hyphens/)
})

test('anything under .claude/ at any depth bypasses the rules', async () => {
  for (const filename of [
    // Auto-memory: snake_case + outside the repo (under $HOME).
    '/Users/x/.claude/projects/-Users-x-projects-foo/memory/user_role.md',
    '/Users/x/.claude/projects/-Users-x-projects-foo/memory/MEMORY.md',
    // Skill / hook subdirs inside a repo's .claude/ — any name works.
    '/Users/x/projects/foo/.claude/skills/some_skill/SOMETHING.md',
    '/Users/x/projects/foo/.claude/hooks/foo/notes_in_camelCase.md',
    '/Users/x/projects/foo/.claude/whateverYouWant.md',
  ]) {
    const result = await runHook({
      tool_input: { content: 'doc', file_path: filename },
      tool_name: 'Write',
    })
    assert.strictEqual(
      result.code,
      0,
      `${filename} should be allowed under .claude/ (got code ${result.code}: ${result.stderr})`,
    )
  }
})
