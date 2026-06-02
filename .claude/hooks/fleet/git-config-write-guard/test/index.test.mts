import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  findBannedBashWrites,
  findBannedConfigWrites,
  isLocalGitConfigPath,
  scanRepoConfig,
} from '../index.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

// ---------------------------------------------------------------------------
// Bash detection
// ---------------------------------------------------------------------------

test('findBannedBashWrites flags core.bare write', () => {
  const hits = findBannedBashWrites('git config core.bare true')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.key, 'core.bare')
  assert.equal(hits[0]!.value, 'true')
})

test('findBannedBashWrites flags user.email write', () => {
  const hits = findBannedBashWrites('git config user.email test@example.com')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.key, 'user.email')
})

test('findBannedBashWrites flags commit.gpgsign write', () => {
  const hits = findBannedBashWrites('git config commit.gpgsign false')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.key, 'commit.gpgsign')
})

test('findBannedBashWrites flags --local explicit scope', () => {
  const hits = findBannedBashWrites('git config --local user.name "Test User"')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.key, 'user.name')
})

test('findBannedBashWrites tolerates leading env-var assignments', () => {
  const hits = findBannedBashWrites(
    'GIT_EDITOR=true git config user.signingkey ABCDEF',
  )
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.key, 'user.signingkey')
})

test('findBannedBashWrites tolerates -c flags before config', () => {
  const hits = findBannedBashWrites(
    'git -c color.ui=false config core.bare true',
  )
  assert.equal(hits.length, 1)
})

test('findBannedBashWrites finds banned key in chained command', () => {
  const hits = findBannedBashWrites(
    'cd /tmp && git config user.email evil@example.com',
  )
  assert.equal(hits.length, 1)
})

test('findBannedBashWrites does NOT flag --global writes', () => {
  const hits = findBannedBashWrites(
    'git config --global user.email john@socket.dev',
  )
  assert.equal(hits.length, 0)
})

test('findBannedBashWrites does NOT flag --system writes', () => {
  const hits = findBannedBashWrites('git config --system core.bare false')
  assert.equal(hits.length, 0)
})

test('findBannedBashWrites does NOT flag --worktree writes', () => {
  const hits = findBannedBashWrites('git config --worktree user.email a@b.c')
  assert.equal(hits.length, 0)
})

test('findBannedBashWrites does NOT flag reads (--get)', () => {
  const hits = findBannedBashWrites('git config --get user.email')
  assert.equal(hits.length, 0)
})

test('findBannedBashWrites does NOT flag reads (-l)', () => {
  const hits = findBannedBashWrites('git config -l')
  assert.equal(hits.length, 0)
})

test('findBannedBashWrites does NOT flag --unset (cleanup is allowed)', () => {
  const hits = findBannedBashWrites('git config --unset user.email')
  assert.equal(hits.length, 0)
})

test('findBannedBashWrites does NOT flag non-banned keys', () => {
  const hits = findBannedBashWrites(
    'git config branch.main.remote origin',
  )
  assert.equal(hits.length, 0)
})

test('findBannedBashWrites does NOT flag non-git commands containing "git config"', () => {
  const hits = findBannedBashWrites('echo "git config user.email is set"')
  assert.equal(hits.length, 0)
})

// ---------------------------------------------------------------------------
// Edit/Write detection (INI parser)
// ---------------------------------------------------------------------------

test('findBannedConfigWrites flags bare = true under [core]', () => {
  const content = '[core]\n\trepositoryformatversion = 0\n\tbare = true\n'
  const hits = findBannedConfigWrites(content)
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.key, 'core.bare')
})

test('findBannedConfigWrites flags user.email under [user]', () => {
  const content = '[user]\n\temail = test@example.com\n\tname = Test User\n'
  const hits = findBannedConfigWrites(content)
  // user.email AND user.name both banned
  assert.equal(hits.length, 2)
  const keys = hits.map(h => h.key).toSorted()
  assert.deepEqual(keys, ['user.email', 'user.name'])
})

test('findBannedConfigWrites flags commit.gpgsign', () => {
  const content = '[commit]\n\tgpgsign = false\n'
  const hits = findBannedConfigWrites(content)
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.key, 'commit.gpgsign')
})

test('findBannedConfigWrites ignores [remote] entries', () => {
  const content =
    '[remote "origin"]\n\turl = git@github.com:foo/bar.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
  const hits = findBannedConfigWrites(content)
  assert.equal(hits.length, 0)
})

test('findBannedConfigWrites ignores comments', () => {
  const content = '[core]\n\t# bare = true (commented out)\n\trepositoryformatversion = 0\n'
  const hits = findBannedConfigWrites(content)
  assert.equal(hits.length, 0)
})

// ---------------------------------------------------------------------------
// Path classification
// ---------------------------------------------------------------------------

test('isLocalGitConfigPath matches /.git/config', () => {
  assert.equal(isLocalGitConfigPath('/repo/.git/config'), true)
  assert.equal(isLocalGitConfigPath('/Users/x/projects/foo/.git/config'), true)
})

test('isLocalGitConfigPath rejects worktree configs', () => {
  assert.equal(
    isLocalGitConfigPath('/repo/.git/worktrees/feature/config'),
    false,
  )
})

test('isLocalGitConfigPath rejects ~/.gitconfig', () => {
  assert.equal(isLocalGitConfigPath('/Users/x/.gitconfig'), false)
})

test('isLocalGitConfigPath rejects unrelated paths', () => {
  assert.equal(isLocalGitConfigPath('/repo/src/config.ts'), false)
  assert.equal(isLocalGitConfigPath('/repo/config'), false)
})

// ---------------------------------------------------------------------------
// SessionStart probe
// ---------------------------------------------------------------------------

function makeRepo(dir: string, configBody: string): string {
  const repoDir = mkdtempSync(path.join(dir, 'repo-'))
  mkdirSync(path.join(repoDir, '.git'), { recursive: true })
  writeFileSync(path.join(repoDir, '.git', 'config'), configBody)
  return path.join(repoDir, '.git', 'config')
}

test('scanRepoConfig detects core.bare = true', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gccfg-'))
  try {
    const cfg = makeRepo(dir, '[core]\n\tbare = true\n')
    const issues = scanRepoConfig(cfg)
    assert.equal(issues.length, 1)
    assert.match(issues[0]!, /core\.bare/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scanRepoConfig detects test@example.com email', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gccfg-'))
  try {
    const cfg = makeRepo(dir, '[user]\n\temail = test@example.com\n')
    const issues = scanRepoConfig(cfg)
    assert.equal(issues.length, 1)
    assert.match(issues[0]!, /test fixture/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scanRepoConfig detects Test User name', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gccfg-'))
  try {
    const cfg = makeRepo(dir, '[user]\n\tname = Test User\n')
    const issues = scanRepoConfig(cfg)
    assert.equal(issues.length, 1)
    assert.match(issues[0]!, /Test User/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scanRepoConfig detects commit.gpgsign = false', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gccfg-'))
  try {
    const cfg = makeRepo(dir, '[commit]\n\tgpgsign = false\n')
    const issues = scanRepoConfig(cfg)
    assert.equal(issues.length, 1)
    assert.match(issues[0]!, /commit\.gpgsign/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scanRepoConfig returns clean for sound config', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gccfg-'))
  try {
    const cfg = makeRepo(
      dir,
      '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = x\n',
    )
    const issues = scanRepoConfig(cfg)
    assert.equal(issues.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// CLI integration (PreToolUse Bash dispatch)
// ---------------------------------------------------------------------------

function runHook(payload: object): { stderr: string; stdout: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env },
  })
  return {
    stderr: String(result.stderr),
    stdout: String(result.stdout),
    exitCode: result.status ?? -1,
  }
}

test('CLI: Bash banned write exits 2', () => {
  const { stderr, exitCode } = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git config core.bare true' },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /git-config-write-guard/)
  assert.match(stderr, /core\.bare/)
})

test('CLI: Bash --global write passes (exit 0)', () => {
  const { exitCode } = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git config --global user.email a@b.c' },
  })
  assert.equal(exitCode, 0)
})

test('CLI: Edit to .git/config with bare=true exits 2', () => {
  const { stderr, exitCode } = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/.git/config',
      old_string: '[core]\n',
      new_string: '[core]\n\tbare = true\n',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /core\.bare/)
})

test('CLI: Edit to unrelated file passes', () => {
  const { exitCode } = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/src/foo.ts',
      old_string: 'a',
      new_string: 'b',
    },
  })
  assert.equal(exitCode, 0)
})

test('CLI: SessionStart with no corrupted repos exits 0 silent', () => {
  const tmpdir = mkdtempSync(path.join(os.tmpdir(), 'gccfg-ss-'))
  try {
    // Point HOME at the empty tmpdir so the probe scans
    // <tmpdir>/projects/ which doesn't exist → no findings.
    const result = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify({ hook_event_name: 'SessionStart' }),
      env: { ...process.env, HOME: tmpdir },
    })
    assert.equal(result.status, 0)
    assert.equal(String(result.stdout).trim(), '')
  } finally {
    rmSync(tmpdir, { recursive: true, force: true })
  }
})
