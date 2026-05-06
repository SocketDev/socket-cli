/**
 * @fileoverview Tests for the release-workflow-guard hook.
 *
 * Runs the hook as a subprocess (node --test), piping a tool-use
 * payload on stdin and asserting on the exit code + stderr. Exit 2
 * means the hook refused the command; exit 0 means it passed it
 * through.
 *
 * The dry-run bypass tests need a fixture workflow on disk because
 * the hook verifies the named workflow declares a `dry-run:` input.
 * Each test that exercises the bypass writes a tmpDir + workflow
 * fixture and points the hook at it via CLAUDE_PROJECT_DIR.
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process, { execPath } from 'node:process'
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { safeDelete } from '@socketsecurity/lib/fs'
import { isSpawnError, spawn } from '@socketsecurity/lib/spawn'

const hookScript = new URL('../index.mts', import.meta.url).pathname

async function runHook(
  command: string,
  toolName = 'Bash',
  env?: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const payload = JSON.stringify({
    tool_name: toolName,
    tool_input: { command },
  })
  return runChild(payload, env)
}

/**
 * Make a tmp project root with a `.github/workflows/<name>.yml`
 * fixture containing the given workflow body. Returns the project
 * dir + a cleanup function. Pass the project dir as CLAUDE_PROJECT_DIR
 * to runHook so the dry-run verification reads the fixture.
 */
async function makeWorkflowFixture(
  filename: string,
  body: string,
): Promise<{ projectDir: string; cleanup: () => Promise<void> }> {
  const projectDir = await fs.mkdtemp(path.join(tmpdir(), 'rwg-fixture-'))
  const wfDir = path.join(projectDir, '.github', 'workflows')
  await fs.mkdir(wfDir, { recursive: true })
  await fs.writeFile(path.join(wfDir, filename), body, 'utf8')
  return {
    projectDir,
    cleanup: async () => {
      await safeDelete(projectDir, { force: true })
    },
  }
}

// Async @socketsecurity/lib/spawn — preferred over child_process
// spawnSync (see CLAUDE.md "Async spawn preferred"). Hooks are
// small, but async tests run in parallel under node --test, so
// even short subprocess waits compound when sync. spawn returns
// `{ stdin, stdout, stderr, process }` synchronously plus a thenable
// for the result; write the payload to stdin and await the result.
// On non-zero exit it throws a SpawnError — catch and lift fields
// back out so tests can assert on code (the hook's exit-2 path is
// the primary thing we test).
async function runChild(
  payload: string,
  env?: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(execPath, [hookScript], {
    timeout: 5_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(env ? { env: { ...process.env, ...env } } : {}),
  })
  child.stdin?.end(payload)
  try {
    const result = await child
    return {
      code: result.code,
      stdout: (result.stdout || '').toString(),
      stderr: (result.stderr || '').toString(),
    }
  } catch (e) {
    if (isSpawnError(e)) {
      return {
        code: e.code,
        stdout: (e.stdout || '').toString(),
        stderr: (e.stderr || '').toString(),
      }
    }
    throw e
  }
}

describe('release-workflow-guard hook', () => {
  describe('blocks dispatching commands', () => {
    it('gh workflow run', async () => {
      const r = await runHook('gh workflow run release.yml')
      assert.equal(r.code, 2)
      assert.match(r.stderr, /BLOCKED/)
      assert.match(r.stderr, /release\.yml/)
    })

    it('gh workflow dispatch', async () => {
      const r = await runHook('gh workflow dispatch publish.yml')
      assert.equal(r.code, 2)
      assert.match(r.stderr, /publish\.yml/)
    })

    it('gh workflow run with -f flags', async () => {
      const r = await runHook(
        'gh workflow run build.yml -f mode=prod -f arch=arm64',
      )
      assert.equal(r.code, 2)
      assert.match(r.stderr, /build\.yml/)
    })

    it('gh api .../dispatches', async () => {
      const r = await runHook(
        'gh api repos/foo/bar/actions/workflows/42/dispatches -X POST',
      )
      assert.equal(r.code, 2)
      assert.match(r.stderr, /42/)
    })

    it('gh workflow run after a chained &&', async () => {
      const r = await runHook('git fetch && gh workflow run release.yml')
      assert.equal(r.code, 2)
    })
  })

  describe('allows benign commands', () => {
    it('plain echo', async () => {
      assert.equal((await runHook('echo hello')).code, 0)
    })

    it('git status', async () => {
      assert.equal((await runHook('git status --short')).code, 0)
    })

    it('gh pr list (not a dispatch)', async () => {
      assert.equal((await runHook('gh pr list --state open')).code, 0)
    })

    it('gh workflow list (read-only, no dispatch)', async () => {
      assert.equal((await runHook('gh workflow list')).code, 0)
    })

    it('gh api repos/.../workflows (no /dispatches)', async () => {
      assert.equal(
        (await runHook('gh api repos/foo/bar/actions/workflows')).code,
        0,
      )
    })
  })

  describe('does not match inside quoted argument bodies', () => {
    it('git commit -m with double-quoted body mentioning gh workflow run', async () => {
      const r = await runHook(
        'git commit -m "chore: blocks dispatching gh workflow run jobs"',
      )
      assert.equal(r.code, 0, `Expected 0 but got ${r.code}: ${r.stderr}`)
    })

    it('git commit -m with heredoc body mentioning gh workflow run', async () => {
      const r = await runHook(
        `git commit -m "$(cat <<'EOF'\nchore: never gh workflow run anything\nEOF\n)"`,
      )
      assert.equal(r.code, 0, `Expected 0 but got ${r.code}: ${r.stderr}`)
    })

    it('echo of a doc string mentioning gh api .../dispatches', async () => {
      const r = await runHook(
        'echo "see also: gh api repos/x/y/actions/workflows/1/dispatches"',
      )
      assert.equal(r.code, 0, `Expected 0 but got ${r.code}: ${r.stderr}`)
    })

    it('single-quoted body protects against dispatch substring', async () => {
      const r = await runHook(
        "echo 'pretend command: gh workflow dispatch foo.yml'",
      )
      assert.equal(r.code, 0, `Expected 0 but got ${r.code}: ${r.stderr}`)
    })
  })

  describe('dry-run bypass', () => {
    // Workflow body that declares a `dry-run:` input. The hook's
    // verification looks for the line `  dry-run:` (any indent) under
    // a `workflow_dispatch.inputs:` block — the body below is the
    // minimal shape that matches.
    const WF_WITH_DRY_RUN = [
      'name: Build',
      'on:',
      '  workflow_dispatch:',
      '    inputs:',
      '      dry-run:',
      '        type: boolean',
      '        default: true',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo build',
    ].join('\n')

    // Same workflow without the dry-run input — bypass shouldn't apply.
    const WF_WITHOUT_DRY_RUN = [
      'name: Publish',
      'on:',
      '  workflow_dispatch: {}',
      'jobs:',
      '  publish:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo publish',
    ].join('\n')

    let projectDir: string
    let cleanup: (() => Promise<void>) | undefined

    afterEach(async () => {
      if (cleanup) {
        await cleanup()
        cleanup = undefined
      }
    })

    it('allows -f dry-run=true on a workflow that declares the input', async () => {
      ;({ projectDir, cleanup } = await makeWorkflowFixture(
        'build.yml',
        WF_WITH_DRY_RUN,
      ))
      const r = await runHook('gh workflow run build.yml -f dry-run=true', 'Bash', {
        CLAUDE_PROJECT_DIR: projectDir,
      })
      assert.equal(r.code, 0, `Expected 0 but got ${r.code}: ${r.stderr}`)
      assert.match(r.stderr, /ALLOWED/)
      assert.match(r.stderr, /verifiable dry-run/)
    })

    it('blocks -f dry-run=true when workflow does NOT declare the input', async () => {
      ;({ projectDir, cleanup } = await makeWorkflowFixture(
        'publish.yml',
        WF_WITHOUT_DRY_RUN,
      ))
      const r = await runHook(
        'gh workflow run publish.yml -f dry-run=true',
        'Bash',
        { CLAUDE_PROJECT_DIR: projectDir },
      )
      assert.equal(r.code, 2, `Expected 2 but got ${r.code}: ${r.stderr}`)
      assert.match(r.stderr, /BLOCKED/)
    })

    it('blocks -f dry-run=true when workflow file does not exist', async () => {
      ;({ projectDir, cleanup } = await makeWorkflowFixture(
        'real.yml',
        WF_WITH_DRY_RUN,
      ))
      const r = await runHook(
        'gh workflow run does-not-exist.yml -f dry-run=true',
        'Bash',
        { CLAUDE_PROJECT_DIR: projectDir },
      )
      assert.equal(r.code, 2)
    })

    it('blocks when -f dry-run=false overrides', async () => {
      ;({ projectDir, cleanup } = await makeWorkflowFixture(
        'build.yml',
        WF_WITH_DRY_RUN,
      ))
      const r = await runHook(
        'gh workflow run build.yml -f dry-run=true -f dry-run=false',
        'Bash',
        { CLAUDE_PROJECT_DIR: projectDir },
      )
      assert.equal(r.code, 2)
    })

    it('blocks when force-prod input is set alongside dry-run=true', async () => {
      ;({ projectDir, cleanup } = await makeWorkflowFixture(
        'build.yml',
        WF_WITH_DRY_RUN,
      ))
      for (const forceArg of [
        '-f release=true',
        '-f publish=true',
        '-f prod=true',
        '-f production=true',
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const r = await runHook(
          `gh workflow run build.yml -f dry-run=true ${forceArg}`,
          'Bash',
          { CLAUDE_PROJECT_DIR: projectDir },
        )
        assert.equal(
          r.code,
          2,
          `expected blocked with ${forceArg} but got ${r.code}: ${r.stderr}`,
        )
      }
    })

    it('blocks when -f dry-run is omitted (default-true is not enough)', async () => {
      // The workflow defaults dry-run to true, but the hook requires
      // explicit -f dry-run=true so a future default flip can't
      // silently turn a benign-looking command into a prod dispatch.
      ;({ projectDir, cleanup } = await makeWorkflowFixture(
        'build.yml',
        WF_WITH_DRY_RUN,
      ))
      const r = await runHook('gh workflow run build.yml', 'Bash', {
        CLAUDE_PROJECT_DIR: projectDir,
      })
      assert.equal(r.code, 2)
    })

    it('snake_case dry_run input does NOT trigger the bypass', async () => {
      // Fleet convention is kebab-case dry-run only. A workflow
      // declaring snake_case must be normalized; the hook
      // intentionally fails the verification rather than guessing.
      const wf = WF_WITH_DRY_RUN.replace('dry-run:', 'dry_run:')
      ;({ projectDir, cleanup } = await makeWorkflowFixture('build.yml', wf))
      const r = await runHook('gh workflow run build.yml -f dry-run=true', 'Bash', {
        CLAUDE_PROJECT_DIR: projectDir,
      })
      assert.equal(r.code, 2)
    })

    it('allows --repo when its basename matches the project dir', async () => {
      // Make a fixture project whose dirname matches the --repo arg's
      // basename. That's the "user runs the dispatch from inside the
      // checkout" common case — the file is locally readable.
      const targetProjectDir = await fs.mkdtemp(
        path.join(tmpdir(), 'rwg-fixture-target-'),
      )
      const matchingName = path.basename(targetProjectDir)
      const wfDir = path.join(targetProjectDir, '.github', 'workflows')
      await fs.mkdir(wfDir, { recursive: true })
      await fs.writeFile(
        path.join(wfDir, 'build.yml'),
        WF_WITH_DRY_RUN,
        'utf8',
      )
      try {
        const r = await runHook(
          `gh workflow run build.yml --repo SocketDev/${matchingName} -f dry-run=true`,
          'Bash',
          { CLAUDE_PROJECT_DIR: targetProjectDir },
        )
        assert.equal(r.code, 0, `Expected 0 but got ${r.code}: ${r.stderr}`)
        assert.match(r.stderr, /ALLOWED/)
      } finally {
        await safeDelete(targetProjectDir, { force: true })
      }
    })

    it('allows --repo when the sibling clone has the workflow', async () => {
      // Setup: parent dir contains two siblings — the current
      // project (where the hook is "rooted") and a target repo with
      // the workflow file. Cross-repo dispatch should resolve via
      // the sibling-clone fallback.
      const parentDir = await fs.mkdtemp(path.join(tmpdir(), 'rwg-fleet-'))
      const currentProject = path.join(parentDir, 'current')
      const siblingProject = path.join(parentDir, 'sibling-target')
      await fs.mkdir(currentProject, { recursive: true })
      await fs.mkdir(path.join(siblingProject, '.github', 'workflows'), {
        recursive: true,
      })
      await fs.writeFile(
        path.join(siblingProject, '.github', 'workflows', 'build.yml'),
        WF_WITH_DRY_RUN,
        'utf8',
      )
      try {
        const r = await runHook(
          'gh workflow run build.yml --repo SocketDev/sibling-target -f dry-run=true',
          'Bash',
          { CLAUDE_PROJECT_DIR: currentProject },
        )
        assert.equal(r.code, 0, `Expected 0 but got ${r.code}: ${r.stderr}`)
        assert.match(r.stderr, /ALLOWED/)
      } finally {
        await safeDelete(parentDir, { force: true })
      }
    })

    it('blocks --repo when no sibling clone exists', async () => {
      // The current project has no sibling named after the --repo
      // target — verification fails (workflow file not readable),
      // bypass denied.
      ;({ projectDir, cleanup } = await makeWorkflowFixture(
        'build.yml',
        WF_WITH_DRY_RUN,
      ))
      const r = await runHook(
        'gh workflow run build.yml --repo SocketDev/no-such-sibling -f dry-run=true',
        'Bash',
        { CLAUDE_PROJECT_DIR: projectDir },
      )
      assert.equal(r.code, 2)
    })

    it('bypass does not apply to gh api .../dispatches', async () => {
      ;({ projectDir, cleanup } = await makeWorkflowFixture(
        'build.yml',
        WF_WITH_DRY_RUN,
      ))
      const r = await runHook(
        'gh api repos/x/y/actions/workflows/build.yml/dispatches -X POST -f inputs.dry-run=true',
        'Bash',
        { CLAUDE_PROJECT_DIR: projectDir },
      )
      assert.equal(r.code, 2)
    })
  })

  describe('payload edge cases', () => {
    it('non-Bash tool is ignored', async () => {
      assert.equal(
        (await runHook('gh workflow run release.yml', 'Read')).code,
        0,
      )
    })

    it('empty command is ignored', async () => {
      assert.equal((await runHook('')).code, 0)
    })

    it('invalid JSON on stdin returns 0 (silent)', async () => {
      // Hook intentionally returns 0 on bad JSON (don't punish the
      // model for unparseable payloads — pass them through).
      const r = await runChild('not json')
      assert.equal(r.code, 0)
    })
  })
})
