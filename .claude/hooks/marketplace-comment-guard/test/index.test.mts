import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function runHook(payload: object): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

function makeFixture(
  marketplaceJson: string | null,
  readme: string | null,
): { dir: string; jsonPath: string; readmePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-guard-'))
  const pluginDir = path.join(dir, '.claude-plugin')
  fs.mkdirSync(pluginDir, { recursive: true })
  const jsonPath = path.join(pluginDir, 'marketplace.json')
  const readmePath = path.join(pluginDir, 'README.md')
  if (marketplaceJson !== null) fs.writeFileSync(jsonPath, marketplaceJson)
  if (readme !== null) fs.writeFileSync(readmePath, readme)
  return { dir, jsonPath, readmePath }
}

const SHA = '9cb4fe4099195b2587c402117a3efce6ab5aac78'
const SHA_OTHER = 'cf6f8515d898ecb921c2da23d08235144fb16601'

const VALID_JSON = JSON.stringify(
  {
    name: 'test',
    plugins: [
      {
        name: 'codex',
        source: {
          source: 'git-subdir',
          url: 'https://github.com/openai/codex-plugin-cc.git',
          path: 'plugins/codex',
          ref: 'v1.0.1',
          sha: SHA,
        },
      },
    ],
  },
  null,
  2,
)

const VALID_README = `# marketplace

| plugin | version | sha                                      | date       | notes |
|--------|---------|------------------------------------------|------------|-------|
| codex  | v1.0.1  | ${SHA} | 2026-05-18 | test  |
`

test('SKIPS non-marketplace paths', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/some/other/file.json',
      content: '{}',
    },
  })
  assert.equal(exitCode, 0)
})

test('SKIPS non-Edit/Write tools', () => {
  const { exitCode } = runHook({
    tool_name: 'Read',
    tool_input: {
      file_path: '/repo/.claude-plugin/marketplace.json',
    },
  })
  assert.equal(exitCode, 0)
})

test('BLOCKS Write of marketplace.json when sibling README is missing', () => {
  const { dir, jsonPath } = makeFixture(null, null)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /sibling file missing/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ALLOWS Write of consistent marketplace.json + on-disk README', () => {
  const { dir, jsonPath } = makeFixture(null, VALID_README)
  try {
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('BLOCKS Write of marketplace.json when README sha is stale', () => {
  const staleReadme = VALID_README.replace(SHA, SHA_OTHER)
  const { dir, jsonPath } = makeFixture(null, staleReadme)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /sha .* does not match/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('BLOCKS Write of marketplace.json when README version is stale', () => {
  const staleReadme = VALID_README.replace('v1.0.1', 'v1.0.0')
  const { dir, jsonPath } = makeFixture(null, staleReadme)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /version .* does not match/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('BLOCKS Write of marketplace.json when README has no row for a plugin', () => {
  const noRowReadme = `# marketplace

| plugin | version | sha | date | notes |
|--------|---------|-----|------|-------|
`
  const { dir, jsonPath } = makeFixture(null, noRowReadme)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /no row in README pin table/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('BLOCKS Write of marketplace.json when README date is malformed', () => {
  const badDateReadme = VALID_README.replace('2026-05-18', 'May 18 2026')
  const { dir, jsonPath } = makeFixture(null, badDateReadme)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /not ISO-8601/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('BLOCKS Write of malformed marketplace.json', () => {
  const { dir, jsonPath } = makeFixture(null, VALID_README)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: '{not json' },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /not parseable JSON/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ALLOWS Write of README with consistent on-disk marketplace.json', () => {
  const { dir, readmePath } = makeFixture(VALID_JSON, null)
  try {
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: readmePath, content: VALID_README },
    })
    assert.equal(exitCode, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('BLOCKS Edit of README that removes a plugin row', () => {
  const { dir, readmePath } = makeFixture(VALID_JSON, VALID_README)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: readmePath,
        old_string: `| codex  | v1.0.1  | ${SHA} | 2026-05-18 | test  |\n`,
        new_string: '',
      },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /no row in README pin table for plugin "codex"/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ALLOWS Edit of README that bumps a row in sync with a JSON bump (simulated by also having the JSON match)', () => {
  // For this case the README is being edited while marketplace.json on
  // disk is already at the new sha. The edit is allowed because the
  // post-edit README + on-disk JSON are consistent.
  const { dir, readmePath } = makeFixture(VALID_JSON, VALID_README)
  try {
    const { exitCode } = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: readmePath,
        // No-op edit (replacing a string with itself) — content stays
        // consistent with on-disk JSON.
        old_string: 'test',
        new_string: 'test',
      },
    })
    assert.equal(exitCode, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
