#!/usr/bin/env node
/**
 * @file Thin entry — `remote:github:release`. Dispatches the repo's
 *   github-release.yml workflow so the release cut runs in CI. DRY-RUN by
 *   default (mirrors the workflow's own `release: false` default — the
 *   dispatch runs the gate + plan, no mutations); pass `--release` to cut
 *   the release for real. The repo-side github-release.yml requires a `tag`
 *   input on manual dispatch (tag pushes resolve it from the pushed ref), so
 *   `--tag v<version>` names the already-pushed tag to release. Only inputs
 *   the target workflow declares are ever sent — GitHub rejects a dispatch
 *   carrying an undeclared input (a `release-as` input was once sent here
 *   and every real dispatch failed). `--repo` lets a member dispatch ITS OWN
 *   workflow. Fail-soft — main() catches, logs, sets a non-zero exit code;
 *   never throws.
 *   CLI: remote:github:release [--release] [--tag <vX.Y.Z>]
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
// .github/workflows/github-release.yml (drift is pinned by the dispatch-args
// parity spec in test/repo/unit/remote-github-release.test.mts).
export const GITHUB_RELEASE_WORKFLOW = 'github-release.yml'

export interface GithubReleaseDispatchArgs {
  release: boolean
  tag: string | undefined
  bundleDryRun: boolean
  repo: string | undefined
  ref: string | undefined
  dryRun: boolean
}

/**
 * Parse `remote:github:release` flags. `--release` flips CI out of dry-run;
 * `--tag` names the already-pushed tag to release (the repo-side workflow
 * requires it on a manual dispatch); `--bundle-dry-run` exercises the
 * wheelhouse bundle-build job instead of the orchestrator; `--repo`, `--ref`
 * optional; `--dry-run` previews the `gh` command locally. Non-strict so an
 * unknown flag never crashes the fail-soft entry.
 */
export function parseGithubReleaseArgs(
  argv: readonly string[],
): GithubReleaseDispatchArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      release: { default: false, type: 'boolean' },
      tag: { type: 'string' },
      'bundle-dry-run': { default: false, type: 'boolean' },
      repo: { type: 'string' },
      ref: { type: 'string' },
      'dry-run': { default: false, type: 'boolean' },
    },
    allowPositionals: false,
    strict: false,
  })
  return {
    release: !!values['release'],
    tag:
      typeof values['tag'] === 'string' && values['tag']
        ? values['tag']
        : undefined,
    bundleDryRun: !!values['bundle-dry-run'],
    repo: typeof values['repo'] === 'string' ? values['repo'] : undefined,
    ref: typeof values['ref'] === 'string' ? values['ref'] : undefined,
    dryRun: !!values['dry-run'],
  }
}

/**
 * The `workflow_dispatch` inputs for github-release.yml. Pure. Always sends
 * `release` (false = the CI dry-run default); forwards `tag` and
 * `bundle-dry-run` ONLY when set (GitHub rejects a dispatch carrying an
 * input the target workflow doesn't declare — `tag` is a base-preset input
 * and `bundle-dry-run` a wheelhouse-override one, so both stay opt-in).
 * `release-as` is deliberately NOT sent: the repo-side github-release.yml
 * releases an existing pushed tag and declares no such input — dispatching
 * it made GitHub reject every real release cut.
 */
export function buildGithubReleaseInputs(
  args: GithubReleaseDispatchArgs,
): Record<string, string> {
  const inputs: Record<string, string> = {
    release: String(args.release),
  }
  if (args.tag !== undefined) {
    inputs['tag'] = args.tag
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
    `remote github release — ${mode}` +
      `${args.tag ? ` (tag ${args.tag})` : ''}` +
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
