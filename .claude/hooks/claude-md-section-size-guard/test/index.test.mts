// node --test specs for the claude-md-section-size-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(
  payload: Record<string, unknown>,
  env?: NodeJS.ProcessEnv,
): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], {
    stdio: 'pipe',
    env: { ...process.env, ...env },
  })
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

const PROLOG = `# Header\n\n<!-- BEGIN FLEET-CANONICAL -->\n\n`
const EPILOG = `\n<!-- END FLEET-CANONICAL -->\n\nAfter the block.\n`

function buildClaudeMd(sections: { heading: string; body: string }[]): string {
  const body = sections
    .map(s => `### ${s.heading}\n\n${s.body}\n`)
    .join('\n')
  return PROLOG + body + EPILOG
}

test('non-Edit/Write tool calls pass through', async () => {
  const result = await runHook({
    tool_input: { command: 'ls' },
    tool_name: 'Bash',
  })
  assert.strictEqual(result.code, 0)
})

test('non-CLAUDE.md targets pass through', async () => {
  const result = await runHook({
    tool_input: {
      file_path: '/Users/x/projects/foo/README.md',
      content: '# README\n\n<!-- BEGIN FLEET-CANONICAL -->\n### s1\n' +
        'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n<!-- END FLEET-CANONICAL -->',
    },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('allows short sections under the default cap', async () => {
  const content = buildClaudeMd([
    { heading: 'Tooling', body: 'Use pnpm.\n\nNever use npx.' },
    { heading: 'Token hygiene', body: 'Redact tokens. Always.' },
  ])
  const result = await runHook({
    tool_input: { file_path: '/x/CLAUDE.md', content },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('blocks a section that exceeds the default 8-line cap', async () => {
  const longBody = Array(12).fill('one detail line').join('\n')
  const content = buildClaudeMd([
    { heading: 'Long rule', body: longBody },
  ])
  const result = await runHook({
    tool_input: { file_path: '/x/CLAUDE.md', content },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Long rule/)
  assert.match(result.stderr, /12 body lines/)
})

test('blank lines do not count toward the cap', async () => {
  // 8 non-blank lines with blanks between — exactly at cap, should pass.
  const lines: string[] = []
  for (let i = 1; i <= 8; i++) {
    lines.push(`line ${i}`)
    lines.push('')
  }
  const body = lines.join('\n').trimEnd()
  const content = buildClaudeMd([{ heading: 'Right at cap', body }])
  const result = await runHook({
    tool_input: { file_path: '/x/CLAUDE.md', content },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('code-fence lines do count toward the cap', async () => {
  // 1 prose + 9 code lines = 10 non-blank > 8 cap. Should block.
  const codeLines: string[] = []
  codeLines.push('```ts')
  for (let i = 0; i < 7; i++) {
    codeLines.push(`const v${i} = ${i}`)
  }
  codeLines.push('```')
  const body = [
    'Use this pattern:', '',
    ...codeLines,
  ].join('\n')
  const content = buildClaudeMd([{ heading: 'Has code block', body }])
  const result = await runHook({
    tool_input: { file_path: '/x/CLAUDE.md', content },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
})

test('reports MULTIPLE too-long sections in one error message', async () => {
  const longBody = Array(30).fill('detail').join('\n')
  const content = buildClaudeMd([
    { heading: 'Section A', body: longBody },
    { heading: 'Section B', body: 'short' },
    { heading: 'Section C', body: longBody },
  ])
  const result = await runHook({
    tool_input: { file_path: '/x/CLAUDE.md', content },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /Section A/)
  assert.match(result.stderr, /Section C/)
  assert.doesNotMatch(result.stderr, /Section B/)
})

test('only checks ### sections, not ## or #', async () => {
  // ## sections are uncapped; should pass even with 30 body lines.
  const longBody = Array(30).fill('detail').join('\n')
  const content =
    PROLOG +
    `## Top-level section\n\n${longBody}\n\n### Subsection\n\nshort\n` +
    EPILOG
  const result = await runHook({
    tool_input: { file_path: '/x/CLAUDE.md', content },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('content OUTSIDE the fleet markers is uncapped', async () => {
  const longBody = Array(50).fill('per-repo detail').join('\n')
  const content =
    `# Repo CLAUDE.md\n\n### Repo-specific rule\n\n${longBody}\n\n` +
    PROLOG +
    `### Fleet rule\n\nshort.\n` +
    EPILOG +
    `\n### Another repo section\n\n${longBody}`
  const result = await runHook({
    tool_input: { file_path: '/x/CLAUDE.md', content },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('respects CLAUDE_MD_FLEET_SECTION_MAX_LINES env override', async () => {
  const body = Array(35).fill('line').join('\n')
  const content = buildClaudeMd([{ heading: 'Bigger section', body }])
  const result = await runHook(
    {
      tool_input: { file_path: '/x/CLAUDE.md', content },
      tool_name: 'Write',
    },
    { CLAUDE_MD_FLEET_SECTION_MAX_LINES: '40' },
  )
  // Cap raised to 40; 35 lines is fine.
  assert.strictEqual(result.code, 0)
})

test('passes through when fleet markers are absent', async () => {
  const content = '# No fleet block\n\n### Rule\n\n' +
    Array(100).fill('line').join('\n')
  const result = await runHook({
    tool_input: { file_path: '/x/CLAUDE.md', content },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('Edit: when on-disk file is unreadable, falls back to new_string', async () => {
  // The /nonexistent path will cause applyEditToFile to return
  // undefined; the hook then scans new_string alone.
  const longSection =
    `<!-- BEGIN FLEET-CANONICAL -->\n### overgrown\n\n` +
    Array(30).fill('x').join('\n') +
    `\n<!-- END FLEET-CANONICAL -->`
  const result = await runHook({
    tool_input: {
      file_path: '/nonexistent/CLAUDE.md',
      old_string: 'a',
      new_string: longSection,
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /overgrown/)
})

test('fails open on malformed stdin', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end('not valid json')
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const code: number = await new Promise(resolve => {
    child.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
  assert.match(stderr, /fail-open/)
})

test('fails open on empty stdin', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  child.stdin.end('')
  const code: number = await new Promise(resolve => {
    child.on('exit', c => resolve(c ?? 0))
  })
  assert.strictEqual(code, 0)
})
