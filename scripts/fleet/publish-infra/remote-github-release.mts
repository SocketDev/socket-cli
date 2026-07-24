#!/usr/bin/env node
/**
 * @file Thin entry — `remote:github:release`. Dispatches the repo's
 *   github-release.yml workflow so the release orchestrator runs in CI (gate →
 *   green → bump → tag → push, then the tag cuts the immutable GitHub Release).
 *   DRY-RUN by default (mirrors the workflow's own `release: false` default —
 *   the dispatch runs the gate + plan, no mutations); pass `--release` to cut
 *   the release for real. `--repo` lets a member dispatch ITS OWN workflow.
 *   Fail-soft — main() catches, logs, sets a non-zero exit code; never throws.
 *   CLI: remote:github:release [--release] [--release-as patch|minor|major]
 *   [--bundle-dry-run] [--repo <owner/name>] [--ref <branch|tag>] [--dry-run]
 *   `--dry-run` is a LOCAL preview of the `gh` command (nothing is dispatched);
 *   `--release` controls whether the dispatched CI run mutates vs. plans.
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runWorkflowDispatch } from './remote-dispatch.mts'
import type { WorkflowDispatchSpec } from './remote-dispatch.mts'
import { logger } from './shared.mts'

// The dispatched workflow. Kept in sync with
// .github/workflows/github-release.yml (the release orchestrator).
export const GITHUB_RELEASE_WORKFLOW = 'github-release.yml'

// Accepted `--release-as` semver levels (github-release.yml's `release-as`
// choice input). An unknown value is dropped so the dispatch doesn't fail the
// workflow's own choice validation.
const RELEASE_LEVELS: ReadonlySet<string> = new Set(['major', 'minor', 'patch'])

export interface GithubReleaseDispatchArgs {
  release: boolean
  releaseAs: string
  bundleDryRun: boolean
  repo: string | undefined
  ref: string | undefined
  dryRun: boolean
}

/**
 * Parse `remote:github:release` flags. `--release` flips CI out of dry-run;
 * `--release-as` defaults to `patch` (falls back to `patch` on an unknown
 * level); `--bundle-dry-run` exercises the bundle-build job instead of the
 * orchestrator; `--repo`, `--ref` optional; `--dry-run` previews the `gh`
 * command locally. Non-strict so an unknown flag never crashes the fail-soft
 * entry.
 */
export function parseGithubReleaseArgs(
  argv: readonly string[],
): GithubReleaseDispatchArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      release: { default: false, type: 'boolean' },
      'release-as': { default: 'patch', type: 'string' },
      'bundle-dry-run': { default: false, type: 'boolean' },
      repo: { type: 'string' },
      ref: { type: 'string' },
      'dry-run': { default: false, type: 'boolean' },
    },
    allowPositionals: false,
    strict: false,
  })
  const rawLevel =
    typeof values['release-as'] === 'string' ? values['release-as'] : 'patch'
  return {
    release: !!values['release'],
    releaseAs: RELEASE_LEVELS.has(rawLevel) ? rawLevel : 'patch',
    bundleDryRun: !!values['bundle-dry-run'],
    repo: typeof values['repo'] === 'string' ? values['repo'] : undefined,
    ref: typeof values['ref'] === 'string' ? values['ref'] : undefined,
    dryRun: !!values['dry-run'],
  }
}

/**
 * The `workflow_dispatch` inputs for github-release.yml. Pure. Always sends
 * `release` (false = the CI dry-run default) + `release-as`; forwards
 * `bundle-dry-run` ONLY when set (its own default is false, so omitting keeps
 * the payload minimal).
 */
export function buildGithubReleaseInputs(
  args: GithubReleaseDispatchArgs,
): Record<string, string> {
  const inputs: Record<string, string> = {
    release: String(args.release),
    'release-as': args.releaseAs,
  }
  if (args.bundleDryRun) {
    inputs['bundle-dry-run'] = 'true'
  }
  return inputs
}

export function buildGithubReleaseSpec(
  args: GithubReleaseDispatchArgs,
): WorkflowDispatchSpec {
  return {
    workflow: GITHUB_RELEASE_WORKFLOW,
    repo: args.repo,
    ref: args.ref,
    inputs: buildGithubReleaseInputs(args),
  }
}

export async function main(): Promise<void> {
  const args = parseGithubReleaseArgs(process.argv.slice(2))
  const mode = args.bundleDryRun
    ? 'bundle dry-run'
    : args.release
      ? 'RELEASE (real)'
      : 'CI dry-run'
  logger.log(
    `remote github release — ${mode} (release-as ${args.releaseAs})` +
      `${args.repo ? `, repo ${args.repo}` : ''}` +
      `${args.dryRun ? ' [local dry-run: not dispatched]' : ''}`,
  )
  const code = await runWorkflowDispatch(buildGithubReleaseSpec(args), {
    dryRun: args.dryRun,
  })
  if (code !== 0) {
    process.exitCode = code
  }
}

// Entrypoint-guarded: importing this module (unit tests of its exported
// helpers) must not execute the CLI.
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.error(errorMessage(e))
    process.exitCode = 1
  })
}
