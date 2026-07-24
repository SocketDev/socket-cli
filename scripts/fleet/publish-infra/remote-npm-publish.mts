#!/usr/bin/env node
/**
 * @file Thin entry — `remote:npm:publish`. Dispatches the repo's
 *   npm-publish.yml workflow so CI runs the staged publish under OIDC trusted
 *   publishing + provenance. No local npm login, no local OTP. DRY-RUN by
 *   default (mirrors the workflow's own `publish: false` default — the dispatch
 *   happens but CI only previews); pass `--publish` to publish for real.
 *   `--repo` lets a member dispatch ITS OWN workflow. Fail-soft — main()
 *   catches, logs, sets a non-zero exit code; it never throws. CLI:
 *   remote:npm:publish [--publish] [--dist-tag <tag>] [--release-as <lvl>]
 *   [--repo <owner/name>] [--ref <branch|tag>] [--dry-run] `--dry-run` is a
 *   LOCAL preview of the `gh` command (nothing is dispatched); `--publish`
 *   controls whether the dispatched CI run publishes vs. previews.
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runWorkflowDispatch } from './remote-dispatch.mts'
import type { WorkflowDispatchSpec } from './remote-dispatch.mts'
import { logger } from './shared.mts'

// The dispatched workflow. Kept in sync with .github/workflows/npm-publish.yml
// (the per-repo staged publisher CI runs).
export const NPM_PUBLISH_WORKFLOW = 'npm-publish.yml'

export interface NpmPublishDispatchArgs {
  publish: boolean
  distTag: string
  releaseAs: string | undefined
  repo: string | undefined
  ref: string | undefined
  dryRun: boolean
}

/**
 * Parse `remote:npm:publish` flags. `--publish` flips CI out of dry-run;
 * `--dist-tag` defaults to `latest`; `--release-as`, `--repo`, `--ref` are
 * optional; `--dry-run` previews the `gh` command locally. Non-strict so an
 * unknown flag never crashes the fail-soft entry.
 */
export function parseNpmPublishArgs(
  argv: readonly string[],
): NpmPublishDispatchArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      publish: { default: false, type: 'boolean' },
      'dist-tag': { default: 'latest', type: 'string' },
      'release-as': { type: 'string' },
      repo: { type: 'string' },
      ref: { type: 'string' },
      'dry-run': { default: false, type: 'boolean' },
    },
    allowPositionals: false,
    strict: false,
  })
  return {
    publish: !!values['publish'],
    distTag:
      typeof values['dist-tag'] === 'string' ? values['dist-tag'] : 'latest',
    releaseAs:
      typeof values['release-as'] === 'string'
        ? values['release-as']
        : undefined,
    repo: typeof values['repo'] === 'string' ? values['repo'] : undefined,
    ref: typeof values['ref'] === 'string' ? values['ref'] : undefined,
    dryRun: !!values['dry-run'],
  }
}

/**
 * The `workflow_dispatch` inputs for npm-publish.yml. Pure. Always sends
 * `publish` (false = the CI dry-run default) + `dist-tag`; forwards
 * `release-as` ONLY when the caller set it (npm-publish.yml doesn't declare it
 * today, and a dispatch with an undeclared input is rejected — so it stays
 * opt-in for a repo whose workflow adds the input).
 */
export function buildNpmPublishInputs(
  args: NpmPublishDispatchArgs,
): Record<string, string> {
  const inputs: Record<string, string> = {
    publish: String(args.publish),
    'dist-tag': args.distTag,
  }
  if (args.releaseAs !== undefined) {
    inputs['release-as'] = args.releaseAs
  }
  return inputs
}

export function buildNpmPublishSpec(
  args: NpmPublishDispatchArgs,
): WorkflowDispatchSpec {
  return {
    workflow: NPM_PUBLISH_WORKFLOW,
    repo: args.repo,
    ref: args.ref,
    inputs: buildNpmPublishInputs(args),
  }
}

export async function main(): Promise<void> {
  const args = parseNpmPublishArgs(process.argv.slice(2))
  logger.log(
    `remote npm publish — ${args.publish ? 'PUBLISH (real)' : 'CI dry-run'} ` +
      `(dist-tag ${args.distTag})${args.repo ? `, repo ${args.repo}` : ''}` +
      `${args.dryRun ? ' [local dry-run: not dispatched]' : ''}`,
  )
  const code = await runWorkflowDispatch(buildNpmPublishSpec(args), {
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
