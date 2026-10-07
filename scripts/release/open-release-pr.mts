#!/usr/bin/env node
/**
 * @file Commit the bump that `bump.mts` wrote into the working tree via the
 *   release App and open the release PR into the release line. The
 *   publish-npm workflow runs this in a job with no dependency install, so the
 *   App token never shares a job with third-party code.
 *
 *   Usage:
 *     node scripts/release/open-release-pr.mts --version 1.5.1
 */

import { execFile as execFileCallback } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { commitViaGithubApi } from './github-api.mts'
import {
  closeSupersededReleasePullRequests,
  discardReleaseBranch,
  openReleaseBranch,
  openReleasePullRequest,
  resolveReleaseEnv,
} from './release-branch.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { ScriptMeta } from '../lib/run-main.mts'

const execFile = promisify(execFileCallback)

const rootPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

// The only files a bump may change. Anything else in the diff means the
// derivation job wrote something it should not have.
const BUMP_FILES = ['CHANGELOG.md', 'package.json']

function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  const value = index === -1 ? undefined : argv[index + 1]
  return value?.startsWith('--') ? undefined : value
}

async function git(args: readonly string[]): Promise<string> {
  const { stdout } = await execFile('git', [...args], {
    cwd: rootPath,
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

export function assertBumpOnly(changedFiles: readonly string[]): void {
  const sorted = [...changedFiles].sort()
  if (
    sorted.length !== BUMP_FILES.length ||
    sorted.some((file, i) => file !== BUMP_FILES[i])
  ) {
    throw new Error(
      '[open-release-pr] the bump must change exactly CHANGELOG.md and package.json.\n' +
        "  Where: the working tree after applying the derivation job's patch.\n" +
        `  Saw: ${sorted.join(', ') || '(no changes)'}.\n` +
        '  Fix: re-dispatch with mode release-pr. If it repeats, inspect bump.mts.',
    )
  }
}

async function main(): Promise<void> {
  const version = readFlag(process.argv.slice(2), 'version')
  if (!version) {
    throw new Error(
      '[open-release-pr] --version is required.\n' +
        "  Fix: pass the derivation job's version output through.",
    )
  }
  const changed = (await git(['diff', '--name-only', 'HEAD']))
    .split('\n')
    .filter(Boolean)
  assertBumpOnly(changed)
  const manifestVersion = (
    JSON.parse(readFileSync(path.join(rootPath, 'package.json'), 'utf8')) as {
      version?: string
    }
  ).version
  if (manifestVersion !== version) {
    throw new Error(
      `[open-release-pr] package.json says ${manifestVersion}, expected ${version}.\n` +
        '  Fix: re-dispatch with mode release-pr so the patch and the version output agree.',
    )
  }

  const env = resolveReleaseEnv()
  const parentSha = (await git(['rev-parse', 'HEAD'])).trim()
  const baseTreeSha = (await git(['rev-parse', 'HEAD^{tree}'])).trim()
  const files = BUMP_FILES.map(relPath => ({
    content: readFileSync(path.join(rootPath, relPath), 'utf8'),
    path: relPath,
  }))
  const releaseBranch = await openReleaseBranch({ env, parentSha, version })
  let sha: string
  try {
    sha = await commitViaGithubApi({
      baseTreeSha,
      branch: releaseBranch.branch,
      files,
      force: true,
      message: `chore(release): ${version}`,
      parentSha,
      repo: env.repo,
      token: env.token,
    })
  } catch (e) {
    if (releaseBranch.created) {
      await discardReleaseBranch(releaseBranch)
    }
    throw e
  }
  const pullRequest = await openReleasePullRequest(releaseBranch)
  const closed = await closeSupersededReleasePullRequests(releaseBranch)
  if (closed.length) {
    process.stdout.write(
      `[open-release-pr] closed superseded release PRs: ${closed.map(n => `#${n}`).join(', ')}\n`,
    )
  }
  process.stdout.write(
    `[open-release-pr] committed ${sha.slice(0, 7)} on ${releaseBranch.branch}, ` +
      `release PR: ${pullRequest.html_url}\n`,
  )
  const summaryPath = process.env['GITHUB_STEP_SUMMARY']
  if (summaryPath) {
    appendFileSync(
      summaryPath,
      `Release PR for ${version}: ${pullRequest.html_url}\n`,
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'commits the bump via the release App and opens the release PR into the release line',
  help: `Usage: node scripts/release/open-release-pr.mts --version <version>

  --version <version>  the version bump.mts derived and wrote into the tree

  The publish-npm workflow runs this in its release-pr mode, after applying
  the bump to a clean checkout. It needs RELEASE_APP_TOKEN with contents:write
  and pull_requests:write, plus the GitHub Actions environment.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
