import { test } from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: sync-required — test flow is sync.
// prefer-spawn-over-execsync: required — uses encoding/input options
// not exposed on the lib spawnSync wrapper.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function runHook(payload: object): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

function makeFixture(
  marketplaceJson: string | undefined,
  readme: string | undefined,
): { dir: string; jsonPath: string; readmePath: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mc-guard-'))
  const pluginDir = path.join(dir, '.claude-plugin')
  mkdirSync(pluginDir, { recursive: true })
  const jsonPath = path.join(pluginDir, 'marketplace.json')
  const readmePath = path.join(pluginDir, 'README.md')
  if (marketplaceJson !== undefined) {
    writeFileSync(jsonPath, marketplaceJson)
  }
  if (readme !== undefined) {
    writeFileSync(readmePath, readme)
  }
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
  const { dir, jsonPath } = makeFixture(undefined, undefined)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /sibling file missing/)
  } finally {
    safeDeleteSync(dir)
  }
})

test('ALLOWS Write of consistent marketplace.json + on-disk README', () => {
  const { dir, jsonPath } = makeFixture(undefined, VALID_README)
  try {
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 0)
  } finally {
    safeDeleteSync(dir)
  }
})

test('BLOCKS Write of marketplace.json when README sha is stale', () => {
  const staleReadme = VALID_README.replace(SHA, SHA_OTHER)
  const { dir, jsonPath } = makeFixture(undefined, staleReadme)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /sha .* does not match/)
  } finally {
    safeDeleteSync(dir)
  }
})

test('BLOCKS Write of marketplace.json when README version is stale', () => {
  const staleReadme = VALID_README.replace('v1.0.1', 'v1.0.0')
  const { dir, jsonPath } = makeFixture(undefined, staleReadme)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /version .* does not match/)
  } finally {
    safeDeleteSync(dir)
  }
})

test('BLOCKS Write of marketplace.json when README has no row for a plugin', () => {
  const noRowReadme = `# marketplace

| plugin | version | sha | date | notes |
|--------|---------|-----|------|-------|
`
  const { dir, jsonPath } = makeFixture(undefined, noRowReadme)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /no row in README pin table/)
  } finally {
    safeDeleteSync(dir)
  }
})

test('BLOCKS Write of marketplace.json when README date is malformed', () => {
  const badDateReadme = VALID_README.replace('2026-05-18', 'May 18 2026')
  const { dir, jsonPath } = makeFixture(undefined, badDateReadme)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: VALID_JSON },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /not ISO-8601/)
  } finally {
    safeDeleteSync(dir)
  }
})

test('BLOCKS Write of malformed marketplace.json', () => {
  const { dir, jsonPath } = makeFixture(undefined, VALID_README)
  try {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: jsonPath, content: '{not json' },
    })
    assert.equal(exitCode, 2)
    assert.match(stderr, /not parseable JSON/)
  } finally {
    safeDeleteSync(dir)
  }
})

test('ALLOWS Write of README with consistent on-disk marketplace.json', () => {
  const { dir, readmePath } = makeFixture(VALID_JSON, undefined)
  try {
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: readmePath, content: VALID_README },
    })
    assert.equal(exitCode, 0)
  } finally {
    safeDeleteSync(dir)
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
    safeDeleteSync(dir)
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
    safeDeleteSync(dir)
  }
})
