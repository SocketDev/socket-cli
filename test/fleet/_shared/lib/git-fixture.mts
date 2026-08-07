/*
 * @file Fast, leak-proof REAL-git fixtures for the integration tier. Use these
 *   when a test genuinely needs git's own behavior; when it only needs the code
 *   under test to ask git a question, inject a fake instead (`./fake-git.mts`)
 *   and skip the subprocess entirely. Every git spawn here goes through
 *   `runGit`, which sanitizes the inherited environment (strips `GIT_DIR` and
 *   friends, pins `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` to a null path)
 *   on each call, so a fixture cannot escape onto the developer's real repo or
 *   `~/.gitconfig`. Three deliberate choices make these cheap, because a spawn
 *   is the single most expensive thing a unit test can do:
 *
 *   1. **Identity comes from `GIT_AUTHOR_*` and `GIT_COMMITTER_*` env**, not from
 *      `git config` calls. A hand-built fixture typically burns three spawns
 *      setting name, email, and gpgsign; this burns zero. The same trick
 *      carries the rest of the fixture config through `GIT_CONFIG_COUNT`.
 *   2. **`--template=` points at an empty directory**, so git skips copying its
 *      sample hooks into every fixture. That is dozens of file writes per
 *      repo.
 *   3. **Reset by filesystem copy, not by re-init.** A `.git` directory is just
 *      files, so `cpSync(…, { recursive: true })` of a repo IS a valid repo.
 *      `snapshotRepo` once, then `restoreRepo` between cases, and the per-case
 *      cost drops from several spawns to one directory copy.
 */

import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  createGitRunner,
  runGitOrThrow,
} from '../../../../.claude/hooks/fleet/_shared/git-runner.mts'

import type { GitRunner } from '../../../../.claude/hooks/fleet/_shared/git-runner.mts'

/**
 * Author and committer a fixture commits as.
 */
export interface GitIdentity {
  name: string
  email: string
  /**
   * Fixed commit timestamp, in any format git accepts. Leave unset for "now";
   * set it when a test needs byte-identical commit hashes across runs.
   */
  date?: string | undefined
}

/**
 * The identity every fixture commits as unless a test overrides it. The address
 * uses the reserved `.invalid` TLD so it can never reach a real mailbox, and it
 * is deliberately not `test@example.com` — that exact value is what leaked onto
 * real developer configs before fixtures were isolated, so seeing it in a real
 * config is a signal worth keeping unambiguous.
 */
export const DEFAULT_GIT_FIXTURE_IDENTITY: GitIdentity = {
  email: 'fixture@fleet.invalid',
  name: 'Fleet Fixture',
}

/**
 * Repo config every fixture runs with, delivered through the environment rather
 * than through `git config` spawns. Signing is off because a fixture must not
 * touch the developer's signing key; `gc.auto` is off so git never forks a
 * background repack mid-test.
 */
export const DEFAULT_GIT_FIXTURE_CONFIG: Readonly<Record<string, string>> = {
  'advice.detachedHead': 'false',
  'commit.gpgsign': 'false',
  'core.autocrlf': 'false',
  'gc.auto': '0',
  'init.defaultBranch': 'main',
  'tag.gpgsign': 'false',
}

/**
 * Branch a fixture repo starts on when a test does not name one.
 */
export const DEFAULT_GIT_FIXTURE_BRANCH = 'main'

/**
 * Temp roots created by this module, so a suite can guarantee cleanup with one
 * `afterAll(cleanupAllGitFixtures)` even if an individual test threw before its
 * own `cleanup()` ran.
 */
const activeFixtureRoots = new Set<string>()

/**
 * Options for {@link gitFixtureEnv}.
 */
export interface GitFixtureEnvOptions {
  identity?: GitIdentity | undefined
  /**
   * Extra `git config` keys, merged over {@link DEFAULT_GIT_FIXTURE_CONFIG}.
   */
  extraConfig?: Readonly<Record<string, string>> | undefined
}

/**
 * Options shared by every fixture constructor.
 */
export interface MakeGitRepoOptions {
  /**
   * Initial branch name. Defaults to {@link DEFAULT_GIT_FIXTURE_BRANCH}.
   */
  branch?: string | undefined
  extraConfig?: Readonly<Record<string, string>> | undefined
  identity?: GitIdentity | undefined
  /**
   * Create an empty first commit so `HEAD` resolves. Defaults to false.
   */
  initialCommit?: boolean | undefined
  /**
   * Prefix for the temp directory name, to make stray dirs identifiable.
   */
  prefix?: string | undefined
}

/**
 * Options for {@link makeRepoWithBareOrigin}.
 */
export interface MakeRepoWithBareOriginOptions extends MakeGitRepoOptions {
  /**
   * Push the initial branch to the bare origin once it exists. Implies
   * `initialCommit`, since there is nothing to push otherwise. Defaults to
   * false.
   */
  push?: boolean | undefined
}

/**
 * Options for {@link GitRepoFixture.commit}.
 */
export interface CommitFileOptions {
  message: string
  /**
   * Path inside the work tree. Defaults to a name derived from the message.
   */
  file?: string | undefined
  /**
   * File contents. Defaults to the message plus a newline.
   */
  contents?: string | undefined
}

/**
 * A real git repo in a temp directory, plus the helpers to drive it.
 */
export interface GitRepoFixture {
  /**
   * Absolute path to the working tree.
   */
  dir: string
  /**
   * Absolute path to the temp root holding the working tree.
   */
  root: string
  /**
   * Environment overlay every spawn in this fixture carries.
   */
  env: NodeJS.ProcessEnv
  /**
   * A `GitRunner` bound to this fixture's environment.
   */
  runner: GitRunner
  /**
   * Run one command in the working tree; returns stdout, throws loud on
   * failure.
   */
  git: (...args: string[]) => string
  /**
   * Run one command in any directory, with this fixture's environment.
   */
  gitIn: (dir: string, ...args: string[]) => string
  /**
   * Write a file, stage it, and commit. Returns the new commit's full hash.
   */
  commit: (options: CommitFileOptions) => string
  /**
   * Write a file relative to the working tree. Returns its absolute path.
   */
  writeFile: (relPath: string, contents: string) => string
  /**
   * Copy the working tree aside so {@link restoreRepo} can reset to it.
   */
  snapshot: () => GitRepoSnapshot
  /**
   * Recursively delete the temp root. Safe to call more than once.
   */
  cleanup: () => void
}

/**
 * A fixture repo plus a bare repo wired up as its `origin` remote.
 */
export interface GitRepoWithOriginFixture extends GitRepoFixture {
  /**
   * Absolute path to the bare origin repo.
   */
  originDir: string
}

/**
 * A filesystem copy of a repo, restorable with zero git spawns.
 */
export interface GitRepoSnapshot {
  /**
   * Directory the copy was taken from, and the one `restoreRepo` writes back
   * to.
   */
  sourceDir: string
  /**
   * Directory holding the copy.
   */
  snapshotDir: string
}

/**
 * Options for {@link snapshotRepo}.
 */
export interface SnapshotRepoOptions {
  /**
   * Directory to copy. Usually a fixture's `dir` or `originDir`.
   */
  dir: string
  /**
   * Where to put the copy. Defaults to a fresh temp directory alongside `dir`,
   * which for a fixture means inside its root, so `cleanup()` removes it too.
   */
  into?: string | undefined
}

/**
 * Build the environment overlay a fixture's git spawns carry: the author and
 * committer identity, plus the fixture config as numbered `GIT_CONFIG_*` pairs.
 *
 * The result is an OVERLAY, not a full environment. `runGit` applies it after
 * sanitizing the inherited environment, so these deliberate values survive
 * while the inherited repo-discovery variables do not.
 */
export function gitFixtureEnv(
  options: GitFixtureEnvOptions = {},
): NodeJS.ProcessEnv {
  const identity = options.identity ?? DEFAULT_GIT_FIXTURE_IDENTITY
  const config: Record<string, string> = {
    ...DEFAULT_GIT_FIXTURE_CONFIG,
    ...options.extraConfig,
  }
  const env: NodeJS.ProcessEnv = {
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_AUTHOR_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
  }
  if (identity.date) {
    env['GIT_AUTHOR_DATE'] = identity.date
    env['GIT_COMMITTER_DATE'] = identity.date
  }
  const keys = Object.keys(config).toSorted()
  env['GIT_CONFIG_COUNT'] = String(keys.length)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    env[`GIT_CONFIG_KEY_${i}`] = key
    env[`GIT_CONFIG_VALUE_${i}`] = config[key]!
  }
  return env
}

/**
 * Create the empty directory handed to `git init --template=`. Git copies the
 * template's contents into every new repo, and the stock template is a pile of
 * sample hooks nobody reads — pointing at an empty directory skips all of it.
 */
export function makeEmptyGitTemplateDir(parentDir: string): string {
  const dir = path.join(parentDir, 'empty-git-template')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Run one command in `dir` with the default fixture environment, returning
 * trimmed stdout and THROWING LOUD on a non-zero or killed spawn.
 *
 * The throw is the point. Returning `stdout.trim()` unconditionally is what
 * makes a git-fixture suite flaky: under parallel load a spawn gets killed,
 * stdout is empty, and the caller hands back `''` as if it were a real hash.
 * The assertion then compares the wrong value and reports a DEFECT in the code
 * under test instead of a killed subprocess.
 */
export function gitIn(dir: string, ...args: string[]): string {
  return runGitOrThrow(args, {
    cwd: dir,
    runner: createGitRunner({ env: gitFixtureEnv() }),
  })
}

/**
 * Create a temp-directory git repo on `branch`, with no sample hooks and no
 * `git config` spawns.
 *
 * Costs exactly one spawn, or two with `initialCommit`.
 */
export function makeGitRepo(options: MakeGitRepoOptions = {}): GitRepoFixture {
  const {
    branch = DEFAULT_GIT_FIXTURE_BRANCH,
    extraConfig,
    identity,
    initialCommit,
    prefix = 'fleet-git-',
  } = options
  const root = mkdtempSync(path.join(os.tmpdir(), prefix))
  activeFixtureRoots.add(root)
  const dir = path.join(root, 'repo')
  const templateDir = makeEmptyGitTemplateDir(root)
  const env = gitFixtureEnv({
    ...(extraConfig ? { extraConfig } : {}),
    ...(identity ? { identity } : {}),
  })
  const fixture = makeFixtureHandle({ dir, env, root })
  fixture.gitIn(
    root,
    'init',
    '-q',
    '-b',
    branch,
    `--template=${templateDir}`,
    dir,
  )
  if (initialCommit) {
    fixture.git('commit', '-q', '--allow-empty', '-m', 'initial commit')
  }
  return fixture
}

/**
 * Create a fixture repo plus a bare repo wired up as its `origin`, so remote
 * operations resolve on local disk with no network.
 *
 * The remote is wired by writing the repo's own `.git/config`, not by spawning
 * `git remote add`. A freshly initialized config has no other writer, so the
 * append is safe, and it saves a spawn on every fixture.
 */
export function makeRepoWithBareOrigin(
  options: MakeRepoWithBareOriginOptions = {},
): GitRepoWithOriginFixture {
  const { push, ...repoOptions } = options
  const fixture = makeGitRepo({
    ...repoOptions,
    ...(push ? { initialCommit: true } : {}),
    prefix: repoOptions.prefix ?? 'fleet-git-origin-',
  })
  const branch = repoOptions.branch ?? DEFAULT_GIT_FIXTURE_BRANCH
  const originDir = path.join(fixture.root, 'origin.git')
  const templateDir = makeEmptyGitTemplateDir(fixture.root)
  fixture.gitIn(
    fixture.root,
    'init',
    '-q',
    '--bare',
    '-b',
    branch,
    `--template=${templateDir}`,
    originDir,
  )
  // Git reads backslashes in a config value as escape sequences, so the URL
  // goes in with forward slashes on every platform.
  appendFileSync(
    path.join(fixture.dir, '.git', 'config'),
    `[remote "origin"]\n\turl = ${normalizePath(originDir)}\n` +
      '\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
    'utf8',
  )
  if (push) {
    fixture.git('push', '-q', 'origin', branch)
  }
  return { ...fixture, originDir }
}

/**
 * Copy a repo aside. The copy is a complete repo in its own right — a `.git`
 * directory is only files — so restoring it needs no git at all.
 */
export function snapshotRepo(options: SnapshotRepoOptions): GitRepoSnapshot {
  const { dir, into } = options
  const snapshotDir =
    into ?? mkdtempSync(path.join(path.dirname(dir), 'snapshot-'))
  mkdirSync(snapshotDir, { recursive: true })
  // preserveTimestamps keeps git's index valid against the copied work tree;
  // without it every file looks newer than the index and git re-hashes them.
  cpSync(dir, snapshotDir, { preserveTimestamps: true, recursive: true })
  return { snapshotDir, sourceDir: dir }
}

/**
 * Reset a repo to a snapshot, with zero git spawns. This is the cheap
 * per-test reset that replaces re-running `git init` and rebuilding history.
 */
export function restoreRepo(snapshot: GitRepoSnapshot): void {
  safeDeleteSync(snapshot.sourceDir)
  mkdirSync(snapshot.sourceDir, { recursive: true })
  cpSync(snapshot.snapshotDir, snapshot.sourceDir, {
    preserveTimestamps: true,
    recursive: true,
  })
}

/**
 * Delete a snapshot's copy. Not needed for a snapshot inside a fixture root.
 */
export function removeSnapshot(snapshot: GitRepoSnapshot): void {
  safeDeleteSync(snapshot.snapshotDir)
}

/**
 * Delete every temp root this module created. Wire it into one
 * `afterAll(cleanupAllGitFixtures)` so a test that throws before its own
 * `cleanup()` still leaves nothing behind.
 */
export function cleanupAllGitFixtures(): void {
  for (const root of activeFixtureRoots) {
    safeDeleteSync(root)
  }
  activeFixtureRoots.clear()
}

/**
 * How many fixture roots are currently live. Leak assertions read this.
 */
export function activeGitFixtureCount(): number {
  return activeFixtureRoots.size
}

/**
 * Options for {@link makeFixtureHandle}.
 */
export interface MakeFixtureHandleOptions {
  dir: string
  env: NodeJS.ProcessEnv
  root: string
}

/**
 * Assemble the callable surface of a fixture around an already-chosen directory
 * and environment. Split out so both constructors build the same object and the
 * repo can be driven before it is fully wired.
 */
export function makeFixtureHandle(
  options: MakeFixtureHandleOptions,
): GitRepoFixture {
  const { dir, env, root } = options
  const runner = createGitRunner({ env })
  function runIn(inDir: string, ...args: string[]): string {
    return runGitOrThrow(args, { cwd: inDir, runner })
  }
  function run(...args: string[]): string {
    return runIn(dir, ...args)
  }
  function writeFile(relPath: string, contents: string): string {
    const target = path.join(dir, relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, contents, 'utf8')
    return target
  }
  function commit(commitOptions: CommitFileOptions): string {
    const { contents, file, message } = commitOptions
    const relPath = file ?? `${message.replaceAll(/[^\w.-]+/g, '-')}.txt`
    writeFile(relPath, contents ?? `${message}\n`)
    run('add', '--', relPath)
    run('commit', '-q', '-m', message)
    return run('rev-parse', 'HEAD')
  }
  function snapshot(): GitRepoSnapshot {
    return snapshotRepo({ dir })
  }
  function cleanup(): void {
    safeDeleteSync(root)
    activeFixtureRoots.delete(root)
  }
  return {
    cleanup,
    commit,
    dir,
    env,
    git: run,
    gitIn: runIn,
    root,
    runner,
    snapshot,
    writeFile,
  }
}
