import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function runHook(
  payload: object,
  options: { cwd?: string } = {},
): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: options.cwd,
  })
  return { stderr: result.stderr ?? '', exitCode: result.status ?? -1 }
}

describe('uses-sha-verify-guard — workflow / action: uses: pin', () => {
  test('blocks workflow `uses:` with truncated SHA', () => {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/.github/workflows/ci.yml',
        content:
          'jobs:\n  job:\n    steps:\n      - uses: actions/checkout@abc123\n',
      },
    })
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/uses-sha-verify-guard/)
    expect(stderr).toMatch(/truncated SHA/)
  })

  test('blocks workflow `uses:` with version tag', () => {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/.github/workflows/ci.yml',
        content: '      - uses: actions/checkout@v4\n',
      },
    })
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/not a SHA pin/)
  })

  test('ignores file outside .github/workflows/ + .github/actions/', () => {
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/README.md',
        content: '      - uses: actions/checkout@v4\n',
      },
    })
    expect(exitCode).toBe(0)
  })
})

describe('uses-sha-verify-guard — .gitmodules: BOTH header + ref required', () => {
  test('blocks .gitmodules submodule missing both header + ref', () => {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/.gitmodules',
        content:
          '[submodule "vendor/foo"]\n\tpath = vendor/foo\n\turl = https://github.com/owner/foo.git\n',
      },
    })
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/missing.*sha256:<64hex>/)
    expect(stderr).toMatch(/missing `ref = <40hex>`/)
  })

  test('blocks .gitmodules submodule with header but no ref', () => {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/.gitmodules',
        content:
          '# foo-1.2.3 sha256:' +
          'a'.repeat(64) +
          '\n[submodule "vendor/foo"]\n\tpath = vendor/foo\n\turl = https://github.com/owner/foo.git\n',
      },
    })
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/missing `ref = <40hex>`/)
  })

  test('blocks .gitmodules header sha256 of wrong length', () => {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/.gitmodules',
        content:
          '# foo-1.2.3 sha256:' +
          'a'.repeat(32) +
          '\n[submodule "vendor/foo"]\n\tpath = vendor/foo\n\tref = ' +
          'b'.repeat(40) +
          '\n',
      },
    })
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/sha256 must be exactly 64 hex chars/)
  })

  test('blocks .gitmodules ref of wrong length', () => {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/.gitmodules',
        content:
          '# foo-1.2.3 sha256:' +
          'a'.repeat(64) +
          '\n[submodule "vendor/foo"]\n\tpath = vendor/foo\n\tref = abc123\n',
      },
    })
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/ref must be exactly 40 hex chars/)
  })
})

describe('uses-sha-verify-guard — package.json GitHub URL deps', () => {
  test('blocks package.json git+https://github.com URL with truncated SHA', () => {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/package.json',
        content:
          '{"dependencies": {"foo": "git+https://github.com/owner/foo#abc123"}}',
      },
    })
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/truncated SHA/)
  })

  test('blocks package.json git+https://github.com URL with version tag', () => {
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/package.json',
        content:
          '{"dependencies": {"foo": "git+https://github.com/owner/foo.git#v1.2.3"}}',
      },
    })
    expect(exitCode).toBe(2)
    expect(stderr).toMatch(/not a SHA pin/)
  })

  test('ignores node_modules/package.json', () => {
    const { exitCode } = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: '/repo/node_modules/foo/package.json',
        content: '{"dependencies": {"x": "git+https://github.com/owner/x#abc"}}',
      },
    })
    expect(exitCode).toBe(0)
  })
})

describe('uses-sha-verify-guard — Bash surface', () => {
  test('passes Bash command that does NOT target workflow files', () => {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    })
    expect(exitCode).toBe(0)
  })

  test('passes Bash command that mentions a workflow path but no SHA', () => {
    const { exitCode } = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'cat .github/workflows/ci.yml' },
    })
    expect(exitCode).toBe(0)
  })

  describe('with a fixture workflow file in cwd', () => {
    let fixtureDir: string

    beforeEach(() => {
      // Spawn the hook with cwd set to a fresh tmpdir holding a
      // workflow file that references actions/checkout. The hook
      // resolves .github/workflows/ci.yml relative to cwd, reads the
      // file, extracts owner/repo from `uses:` lines, and then
      // verifies any lone SHAs against those repos. With a known
      // fixture in place the test is deterministic, not conditional.
      fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'sha-guard-fixture-'))
      mkdirSync(path.join(fixtureDir, '.github', 'workflows'), {
        recursive: true,
      })
      writeFileSync(
        path.join(fixtureDir, '.github', 'workflows', 'ci.yml'),
        `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4 (2024-12-13)
`,
        'utf8',
      )
    })

    afterEach(() => {
      rmSync(fixtureDir, { recursive: true, force: true })
    })

    test('blocks sed substitution with a fabricated SHA against known owner/repos', () => {
      // `actions/checkout` is the only owner/repo in the fixture
      // ci.yml. A deadbeef SHA cannot resolve there, so the guard
      // must exit 2.
      const fabricatedSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      const { stderr, exitCode } = runHook(
        {
          tool_name: 'Bash',
          tool_input: {
            command: `sed -i.bak 's|old|${fabricatedSha}|g' .github/workflows/ci.yml`,
          },
        },
        { cwd: fixtureDir },
      )
      expect(exitCode).toBe(2)
      expect(stderr).toMatch(/Bash surface/)
      expect(stderr).toMatch(/not reachable/)
      expect(stderr).toMatch(/deadbeefde/)
    })

    test('rejects path-traversal attempt that would escape cwd', () => {
      // `.github/workflows/../../../etc/passwd.yml` matches the regex
      // but escapes cwd. isPathInsideCwd should reject it, so no
      // owner/repos are extracted and the lone-SHA pass exits
      // green (no candidates to verify against).
      const fabricatedSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      const { exitCode } = runHook(
        {
          tool_name: 'Bash',
          tool_input: {
            command: `sed -i.bak 's|old|${fabricatedSha}|g' .github/workflows/../../../etc/passwd.yml`,
          },
        },
        { cwd: fixtureDir },
      )
      expect(exitCode).toBe(0)
    })
  })
})
