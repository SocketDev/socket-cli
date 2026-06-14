// node --test specs for the clone-reviewed-repo-nudge hook.
//
// Two layers: direct unit tests of the pure detect.mts helpers, and
// subprocess integration tests that feed a PreToolUse payload on stdin and
// assert the nudge fired (stderr) — exit code is always 0 (a nudge never
// blocks).

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child subprocess
// and pipes stdin/stdout/stderr; Node spawn returns the ChildProcess streaming
// surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  externalGhRepo,
  isFleetOrg,
  missingCloneFlags,
  parseGithubSlug,
  repoClonesName,
} from '../detect.mts'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

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

function bash(command: string): Record<string, unknown> {
  return { tool_input: { command }, tool_name: 'Bash' }
}

// --- unit: parseGithubSlug ------------------------------------------------

test('parseGithubSlug parses an https URL', () => {
  assert.deepStrictEqual(parseGithubSlug('https://github.com/justrach/codedb'), {
    owner: 'justrach',
    repo: 'codedb',
  })
})

test('parseGithubSlug strips a trailing .git', () => {
  assert.deepStrictEqual(
    parseGithubSlug('https://github.com/justrach/codedb.git'),
    { owner: 'justrach', repo: 'codedb' },
  )
})

test('parseGithubSlug parses an ssh remote', () => {
  assert.deepStrictEqual(parseGithubSlug('git@github.com:facebook/react.git'), {
    owner: 'facebook',
    repo: 'react',
  })
})

test('parseGithubSlug parses a bare owner/repo slug', () => {
  assert.deepStrictEqual(parseGithubSlug('facebook/react'), {
    owner: 'facebook',
    repo: 'react',
  })
})

test('parseGithubSlug rejects a non-github url', () => {
  assert.strictEqual(parseGithubSlug('https://example.com/a/b'), undefined)
})

test('parseGithubSlug rejects a deep path that is not owner/repo', () => {
  assert.strictEqual(parseGithubSlug('a/b/c'), undefined)
})

// --- unit: isFleetOrg / repoClonesName ------------------------------------

test('isFleetOrg matches SocketDev case-insensitively', () => {
  assert.strictEqual(isFleetOrg('SocketDev'), true)
  assert.strictEqual(isFleetOrg('socketdev'), true)
  assert.strictEqual(isFleetOrg('facebook'), false)
})

test('repoClonesName lowercases + dash-cases', () => {
  assert.strictEqual(repoClonesName('justrach', 'codedb'), 'justrach-codedb')
  assert.strictEqual(repoClonesName('Foo.Bar', 'Baz_Qux'), 'foo-bar-baz-qux')
})

// --- unit: missingCloneFlags ----------------------------------------------

test('missingCloneFlags flags a bare external clone (all three missing)', () => {
  const r = missingCloneFlags(['clone', 'https://github.com/facebook/react'])
  assert.ok(r)
  assert.deepStrictEqual(r.missing, [
    '--depth=1',
    '--single-branch',
    '--filter=blob:none',
  ])
})

test('missingCloneFlags returns empty missing[] when all flags present', () => {
  const r = missingCloneFlags([
    'clone',
    '--depth=1',
    '--single-branch',
    '--filter=blob:none',
    'https://github.com/facebook/react',
  ])
  assert.ok(r)
  assert.deepStrictEqual(r.missing, [])
})

test('missingCloneFlags reports only the genuinely-missing flags', () => {
  const r = missingCloneFlags([
    'clone',
    '--depth',
    '1',
    'https://github.com/facebook/react',
  ])
  assert.ok(r)
  assert.deepStrictEqual(r.missing, ['--single-branch', '--filter=blob:none'])
})

test('missingCloneFlags exempts a SocketDev (fleet) repo', () => {
  assert.strictEqual(
    missingCloneFlags(['clone', 'https://github.com/SocketDev/socket-cli']),
    undefined,
  )
})

test('missingCloneFlags ignores a non-clone git subcommand', () => {
  assert.strictEqual(
    missingCloneFlags(['status', 'https://github.com/facebook/react']),
    undefined,
  )
})

test('missingCloneFlags ignores a clone with no github url (local path)', () => {
  assert.strictEqual(missingCloneFlags(['clone', '/tmp/some/repo']), undefined)
})

// --- unit: externalGhRepo -------------------------------------------------

test('externalGhRepo finds a `repo view owner/repo` positional', () => {
  assert.deepStrictEqual(externalGhRepo(['repo', 'view', 'facebook/react']), {
    owner: 'facebook',
    repo: 'react',
  })
})

test('externalGhRepo finds a --repo flag value', () => {
  assert.deepStrictEqual(
    externalGhRepo(['pr', 'list', '--repo', 'facebook/react']),
    { owner: 'facebook', repo: 'react' },
  )
})

test('externalGhRepo finds a -R flag value', () => {
  assert.deepStrictEqual(externalGhRepo(['pr', 'view', '-R', 'facebook/react']), {
    owner: 'facebook',
    repo: 'react',
  })
})

test('externalGhRepo finds a --repo=slug form', () => {
  assert.deepStrictEqual(
    externalGhRepo(['issue', 'list', '--repo=facebook/react']),
    { owner: 'facebook', repo: 'react' },
  )
})

test('externalGhRepo exempts a SocketDev fleet repo', () => {
  assert.strictEqual(
    externalGhRepo(['pr', 'view', '--repo', 'SocketDev/socket-cli']),
    undefined,
  )
})

test('externalGhRepo returns undefined for a flag-only gh command', () => {
  assert.strictEqual(externalGhRepo(['auth', 'status']), undefined)
})

// --- integration: arm (1), git clone --------------------------------------

test('nudges a bare external git clone (stderr, exit 0)', async () => {
  const r = await runHook(bash('git clone https://github.com/facebook/react'))
  assert.strictEqual(r.code, 0)
  assert.match(r.stderr, /clone-reviewed-repo-nudge/)
  assert.match(r.stderr, /--filter=blob:none/)
  assert.match(r.stderr, /facebook-react/)
})

test('does NOT nudge a fully-flagged external clone', async () => {
  const r = await runHook(
    bash(
      'git clone --depth=1 --single-branch --filter=blob:none https://github.com/facebook/react /tmp/x',
    ),
  )
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr.trim(), '')
})

test('does NOT nudge a SocketDev clone', async () => {
  const r = await runHook(
    bash('git clone https://github.com/SocketDev/socket-cli'),
  )
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr.trim(), '')
})

test('does NOT nudge a non-Bash tool call', async () => {
  const r = await runHook({
    tool_input: { file_path: '/x', content: 'y' },
    tool_name: 'Write',
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr.trim(), '')
})

// --- integration: arm (2), gh review --------------------------------------

test('nudges a `gh repo view` of an external repo', async () => {
  const r = await runHook(bash('gh repo view facebook/react'))
  assert.strictEqual(r.code, 0)
  assert.match(r.stderr, /Reviewing external repo facebook\/react/)
  assert.match(r.stderr, /repo-clones/)
})

test('does NOT nudge `gh pr view` of a SocketDev repo', async () => {
  const r = await runHook(bash('gh pr view 5 --repo SocketDev/socket-cli'))
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr.trim(), '')
})

test('nudges within a chained command (git clone after a cd)', async () => {
  const r = await runHook(
    bash('mkdir -p /tmp/x && git clone https://github.com/torvalds/linux'),
  )
  assert.strictEqual(r.code, 0)
  assert.match(r.stderr, /torvalds-linux/)
})
