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
 *   [--no-bump] [--backfill-version <ver>] [--checkout-ref <ref>]
 *   [--repo <owner/name>]
 *   [--ref <branch|tag>] [--dry-run] `--dry-run` is a LOCAL preview of the
 *   `gh` command (nothing is dispatched); `--publish` controls whether the
 *   dispatched CI run publishes vs. previews. `--backfill-version` +
 *   `--checkout-ref` dispatch the sanctioned gap-fill backfill mode — CI
 *   enforces the hard guards (publish-infra/npm/backfill.mts).
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
  // False (`--no-bump`) skips the workflow's CI bump step — for callers whose
  // bump commit already landed (the publish pipeline), so the whole chain
  // bumps exactly once.
  bump: boolean
  backfillVersion: string | undefined
  checkoutRef: string | undefined
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
      // parseArgs supports `--no-bump` negation natively for boolean flags.
      bump: { default: true, type: 'boolean' },
      'backfill-version': { type: 'string' },
      'checkout-ref': { type: 'string' },
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
    bump: values['bump'] !== false,
    releaseAs:
      typeof values['release-as'] === 'string'
        ? values['release-as']
        : undefined,
    backfillVersion:
      typeof values['backfill-version'] === 'string'
        ? values['backfill-version']
        : undefined,
    checkoutRef:
      typeof values['checkout-ref'] === 'string'
        ? values['checkout-ref']
        : undefined,
    repo: typeof values['repo'] === 'string' ? values['repo'] : undefined,
    ref: typeof values['ref'] === 'string' ? values['ref'] : undefined,
    dryRun: !!values['dry-run'],
  }
}

/**
 * The `workflow_dispatch` inputs for npm-publish.yml. Pure. Always sends
 * `publish` (false = the CI dry-run default) + `dist-tag`; forwards
 * `release-as`, `bump=false`, `backfill-version`, and `checkout-ref` ONLY
 * when the caller set them off their defaults (a dispatch with an input the
 * target workflow doesn't declare is rejected — so they stay opt-in for
 * repos whose workflow predates them).
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
  if (!args.bump) {
    inputs['bump'] = 'false'
  }
  if (args.backfillVersion !== undefined) {
    inputs['backfill-version'] = args.backfillVersion
  }
  if (args.checkoutRef !== undefined) {
    inputs['checkout-ref'] = args.checkoutRef
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
