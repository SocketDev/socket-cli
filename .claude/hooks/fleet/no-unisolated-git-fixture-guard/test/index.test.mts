import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildsTempFixture,
  isIsolated,
  isTestFilePath,
  shouldBlock,
  spawnsGit,
} from '../index.mts'

describe('isTestFilePath', () => {
  it('matches test/spec files and test dirs', () => {
    assert.equal(isTestFilePath('test/initial-commit-amend.test.mts'), true)
    assert.equal(isTestFilePath('src/foo.spec.ts'), true)
    assert.equal(isTestFilePath('pkg/__tests__/a.test.mts'), true)
    assert.equal(isTestFilePath('src/foo.mts'), false)
    assert.equal(isTestFilePath('scripts/build.mts'), false)
  })
})

describe('spawnsGit', () => {
  it('detects git child-process spawns', () => {
    assert.equal(spawnsGit("spawnSync('git', ['init', dir])"), true)
    assert.equal(spawnsGit('spawn("git", args)'), true)
    assert.equal(spawnsGit("execFileSync('git', ['config'])"), true)
    assert.equal(spawnsGit("spawnSync('node', ['x'])"), false)
    assert.equal(spawnsGit('const msg = "git is great"'), false)
  })
})

describe('buildsTempFixture', () => {
  it('true only when a temp dir + git init are both present', () => {
    assert.equal(
      buildsTempFixture(
        "const dir = mkdtempSync(path.join(tmpdir(), 'x'))\ngit(['init'])",
      ),
      true,
    )
    // temp dir but no init → not a fixture-build signal
    assert.equal(buildsTempFixture('const dir = mkdtempSync(tmpdir())'), false)
    // init but no temp dir → operating on the real repo, out of scope
    assert.equal(buildsTempFixture("git(['init', '-q'])"), false)
  })
})

describe('isIsolated', () => {
  it('true when GIT_CONFIG_GLOBAL is pinned', () => {
    assert.equal(
      isIsolated("process.env.GIT_CONFIG_GLOBAL = '/dev/null'"),
      true,
    )
  })
  it('true when GIT_DIR is stripped via delete', () => {
    assert.equal(isIsolated("delete process.env['GIT_DIR']"), true)
  })
  it('true with a LEAKY_GIT scrub list mentioning GIT_DIR', () => {
    assert.equal(
      isIsolated("const LEAKY_GIT_VARS = ['GIT_DIR','GIT_WORK_TREE']"),
      true,
    )
  })
  it('true with a side-effect import of the shared isolate-git-env helper', () => {
    assert.equal(
      isIsolated("import '../../_shared/isolate-git-env.mts'"),
      true,
    )
  })
  it('true with a named import of isolateGitEnv', () => {
    assert.equal(
      isIsolated(
        "import { isolateGitEnv } from '../../_shared/isolate-git-env.mts'",
      ),
      true,
    )
  })
  it('false when no isolation present', () => {
    assert.equal(isIsolated("spawnSync('git', ['init', dir])"), false)
  })
})

describe('shouldBlock', () => {
  const LEAKY = [
    "const dir = mkdtempSync(path.join(tmpdir(), 'fx-'))",
    "spawnSync('git', ['init', '-q'], { cwd: dir })",
    "spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })",
  ].join('\n')

  const ISOLATED = [
    "const dir = mkdtempSync(path.join(tmpdir(), 'fx-'))",
    "delete process.env['GIT_DIR']",
    "process.env.GIT_CONFIG_GLOBAL = '/dev/null'",
    "spawnSync('git', ['init', '-q'], { cwd: dir })",
  ].join('\n')

  it('blocks an unisolated temp-dir git fixture in a test file', () => {
    assert.equal(
      shouldBlock('test/unit/sync-scaffolding/initial-commit-amend.test.mts', LEAKY),
      true,
    )
  })
  it('allows when the fixture isolates the git env', () => {
    assert.equal(shouldBlock('test/foo.test.mts', ISOLATED), false)
  })
  it('does not fire on non-test files', () => {
    assert.equal(shouldBlock('scripts/repo/sync-scaffolding/commit.mts', LEAKY), false)
  })
  it('does not fire when the test spawns git but builds no temp fixture', () => {
    assert.equal(
      shouldBlock(
        'test/foo.test.mts',
        "const sha = spawnSync('git', ['rev-parse', 'HEAD']).stdout",
      ),
      false,
    )
  })
})
