#!/usr/bin/env node
/**
 * @file Land or discard the bump the run created. This is the last thing the
 *   npm-publish workflow does, and it runs whether the publish succeeded or not.
 *
 *   Success fast-forwards the release line to the bump commit and deletes the
 *   throwaway branch. Failure deletes the branch and leaves the release line
 *   alone, which is what makes a failed run cost nothing but the burned version
 *   number.
 *
 *   Usage:
 *     node scripts/release/promote.mts --branch npm-publish-v1.1.155 --sha <sha>
 *     node scripts/release/promote.mts --branch npm-publish-v1.1.155 --sha <sha> --discard
 */

import process from 'node:process'

import {
  discardReleaseBranch,
  promoteReleaseBranch,
  resolveReleaseEnv,
} from './release-branch.mts'
import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

import type { ScriptMeta } from '../lib/run-main.mts'

function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? undefined : argv[index + 1]
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const branch = readFlag(argv, 'branch')
  const sha = readFlag(argv, 'sha')
  const discard = argv.includes('--discard')
  if (!branch || !sha) {
    throw new Error(
      '[promote] --branch and --sha are both required.\n' +
        "  Where: the npm-publish workflow's landing step.\n" +
        '  Saw: a missing flag; wanted the bump branch name and its tip SHA.\n' +
        "  Fix: pass the bump step's release-branch and sha outputs through.",
    )
  }
  const env = resolveReleaseEnv()
  // The version is only used in the log line; the branch name carries it.
  const releaseBranch = {
    branch,
    env,
    version: branch.replace(/^npm-publish-v/, ''),
  }
  if (discard) {
    await discardReleaseBranch(releaseBranch)
    return
  }
  await promoteReleaseBranch(releaseBranch, sha)
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'lands or discards the throwaway release branch the bump stage created',
  help: `Usage: node scripts/release/promote.mts --branch <name> --sha <sha> [--discard]

  --branch <name>  the npm-publish-v<version> branch the bump stage opened
  --sha <sha>      that branch's tip commit
  --discard        delete the branch instead of landing it, which is what a
                   failed publish run does

  The npm-publish workflow runs this last, whether the publish succeeded or
  not. It needs RELEASE_APP_TOKEN and the GitHub Actions environment.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
