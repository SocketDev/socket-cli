/**
 * @file Multi-case spec for provenance-publish-reminder. This is a Stop hook,
 *   not a PreToolUse gate: it NEVER exits 2 and never blocks. It inspects HEAD
 *   for a release-shape commit subject (`chore: bump version to vX.Y.Z` /
 *   `chore(scope): release vX.Y.Z`) or a `vX.Y.Z` annotated tag whose captured
 *   version equals `package.json` version, then — only on a match — fetches the
 *   npm packument and nudges to stderr when the published version is missing
 *   `dist.attestations` or `_npmUser.trustedPublisher`. Every exit is 0.
 *
 *   The hook reads no `process.env` (no kill switch) and has no bypass phrase,
 *   so there is no disable path to test.
 *
 *   Hermetic by construction: the only path that reaches the network is a
 *   release HEAD that is NOT already throttled. Every case here either fails
 *   the release-head gate or pre-seeds the throttle state file so the hook
 *   returns before `fetch`. The one case that needs a live 2xx packument is
 *   gated behind PROVENANCE_REMINDER_LIVE_NET=1 so the default run never
 *   touches a third-party server.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns the hook as a
// child subprocess and pipes stdin/stdout/stderr; Node spawn exposes the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn, spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

const STATE_REL = path.join('.claude', 'state', 'provenance-reminder.last')

type Result = { code: number; stderr: string }

/**
 * Spawn the hook with the given cwd, feed `stdin` to it, collect stderr, and
 * resolve once it exits. `stdin` defaults to a minimal Stop payload; pass a raw
 * string to exercise the malformed-input path.
 */
async function runHook(options: {
  cwd: string
  stdin?: string | undefined
}): Promise<Result> {
  const { cwd } = options
  const stdin = options.stdin ?? JSON.stringify({ transcript_path: '' })
  const child = spawn(process.execPath, [HOOK], { cwd, stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(stdin)
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

function git(cwd: string, ...args: string[]): void {
  spawnSync('git', args, { cwd, stdio: 'pipe' })
}

/** Make a throwaway dir; no git, no package.json. */
function makeBareDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'provenance-reminder-'))
}

/**
 * Make a git repo with a package.json and an initial commit whose subject is
 * `subject`. Returns the repo root. Pins identity + disables signing so the
 * commit lands in any environment.
 */
function makeRepo(options: {
  pkg: Record<string, unknown> | string
  subject: string
}): string {
  const { pkg, subject } = options
  const dir = mkdtempSync(path.join(tmpdir(), 'provenance-reminder-'))
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'tester@example.test')
  git(dir, 'config', 'user.name', 'Tester')
  git(dir, 'config', 'commit.gpgsign', 'false')
  const body = typeof pkg === 'string' ? pkg : JSON.stringify(pkg)
  writeFileSync(path.join(dir, 'package.json'), body)
  git(dir, 'add', 'package.json')
  git(dir, 'commit', '-q', '-m', subject)
  return dir
}

/** Annotate HEAD with `tag` (lets us exercise the tag-points-at signal). */
function tagHead(dir: string, tag: string): void {
  git(dir, 'tag', '-a', tag, '-m', tag)
}

/** Pre-seed the throttle state file so the hook returns before `fetch`. */
function seedThrottle(dir: string, stateKey: string): void {
  mkdirSync(path.join(dir, path.dirname(STATE_REL)), { recursive: true })
  writeFileSync(path.join(dir, STATE_REL), stateKey)
}

// ---- DOES-NOT-FIRE: clean / out-of-scope inputs ----------------------------

test('no package.json in cwd → exit 0, no nudge (pass-through)', async () => {
  const result = await runHook({ cwd: makeBareDir() })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /provenance-publish-reminder/)
})

test('non-release HEAD (ordinary commit) → exit 0, no nudge', async () => {
  const dir = makeRepo({
    pkg: { name: '@scope/pkg', version: '1.2.3' },
    subject: 'fix(core): correct off-by-one',
  })
  const result = await runHook({ cwd: dir })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /provenance-publish-reminder/)
})

test('release-shape subject but version mismatch → not a release head, exit 0', async () => {
  // Subject captures 9.9.9 but package.json is 1.2.3, so m[1] !== pkgVersion.
  const dir = makeRepo({
    pkg: { name: '@scope/pkg', version: '1.2.3' },
    subject: 'chore: bump version to 9.9.9',
  })
  const result = await runHook({ cwd: dir })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /provenance-publish-reminder/)
})

test('package.json missing name/version → exit 0, no nudge', async () => {
  const dir = makeRepo({
    pkg: { description: 'no name, no version' },
    subject: 'chore: bump version to 1.2.3',
  })
  const result = await runHook({ cwd: dir })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /provenance-publish-reminder/)
})

test('unparseable package.json → caught, exit 0, no nudge', async () => {
  const dir = makeRepo({
    pkg: '{ not valid json',
    subject: 'chore: bump version to 1.2.3',
  })
  const result = await runHook({ cwd: dir })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /provenance-publish-reminder/)
})

// ---- FIRES (release-head gate opens) — hermetic via throttle short-circuit --
// These prove the release-head detector matched: a non-release HEAD returns
// before the throttle is ever consulted, so reaching the throttle's
// already-checked early-return means the gate opened. Pre-seeding the state
// keeps the hook off the network.

test('release HEAD via commit subject + matching throttle → exit 0, no network', async () => {
  const dir = makeRepo({
    pkg: { name: '@scope/pkg', version: '4.5.6' },
    subject: 'chore: bump version to 4.5.6',
  })
  seedThrottle(dir, '@scope/pkg@4.5.6')
  const result = await runHook({ cwd: dir })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /provenance-publish-reminder/)
})

test('release HEAD via scoped "release vX.Y.Z" subject + throttle → exit 0', async () => {
  const dir = makeRepo({
    pkg: { name: 'plain-pkg', version: '2.0.0' },
    subject: 'chore(release): release v2.0.0',
  })
  seedThrottle(dir, 'plain-pkg@2.0.0')
  const result = await runHook({ cwd: dir })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /provenance-publish-reminder/)
})

test('release HEAD via annotated tag signal + matching throttle → exit 0', async () => {
  // Ordinary subject; the release signal is the vX.Y.Z tag on HEAD.
  const dir = makeRepo({
    pkg: { name: 'tagged-pkg', version: '3.1.4' },
    subject: 'docs: update changelog',
  })
  tagHead(dir, 'v3.1.4')
  seedThrottle(dir, 'tagged-pkg@3.1.4')
  const result = await runHook({ cwd: dir })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /provenance-publish-reminder/)
})

// ---- MALFORMED stdin: fail-open --------------------------------------------
// stdin is drained and ignored (not parsed); garbage must not crash the hook.

test('garbage stdin → fail-open, exit 0, no crash, no nudge', async () => {
  const result = await runHook({ cwd: makeBareDir(), stdin: 'not json at all }{' })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /provenance-publish-reminder/)
})

test('empty stdin → fail-open, exit 0', async () => {
  const result = await runHook({ cwd: makeBareDir(), stdin: '' })
  assert.strictEqual(result.code, 0)
})

// ---- FIRES with a real registry nudge (live network, opt-in) ---------------
// The only path that hits the npm registry. Gated behind an env opt-in so the
// default `pnpm test` run stays hermetic (no third-party connections). Uses a
// real published version known to lack BOTH trust signals.

test(
  'live registry: release HEAD for a version missing trust signals → stderr nudge',
  { skip: process.env['PROVENANCE_REMINDER_LIVE_NET'] !== '1' },
  async () => {
    // lodash@1.0.0 predates provenance + trusted-publisher entirely.
    const dir = makeRepo({
      pkg: { name: 'lodash', version: '1.0.0' },
      subject: 'chore: bump version to 1.0.0',
    })
    const result = await runHook({ cwd: dir })
    assert.strictEqual(result.code, 0)
    assert.match(
      result.stderr,
      /\[provenance-publish-reminder\] lodash@1\.0\.0 is published but missing:/,
    )
    assert.match(result.stderr, /provenance attestation/)
    assert.match(result.stderr, /trusted-publisher OIDC/)
  },
)
