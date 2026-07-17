/**
 * @file Registry-agnostic REMOTE workflow dispatch. The fleet's publish model
 *   is remote-first: releases run in GitHub Actions under OIDC trusted
 *   publishing (id-token: write + provenance) — no local npm login, no local
 *   OTP. These helpers turn a local `pnpm run remote:*` into a `gh workflow run
 *   <file> -f key=value` dispatch, so a member can kick off ITS OWN CI
 *   publish/release without ever holding a registry credential. Two seams: a
 *   PURE `buildWorkflowRunArgs` (the `gh` argv, unit-testable with no spawn)
 *   and a fail-soft `runWorkflowDispatch` (spawns `gh` via runInherit, with an
 *   injectable exec so tests never shell out). The npm-publish + github-release
 *   thin entries just parse flags and compose a spec. Fail-soft: a non-zero
 *   `gh` exit or a thrown spawn error becomes a returned non-zero code the
 *   caller maps onto process.exitCode; nothing throws.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { logger, rootPath, runInherit } from './shared.mts'

/**
 * A `gh workflow run` dispatch: the workflow file, the optional target repo
 * (`--repo owner/name`) + git ref (`--ref branch|tag`), and the
 * `workflow_dispatch` inputs (each becomes a `-f key=value`).
 */
export interface WorkflowDispatchSpec {
  readonly workflow: string
  readonly repo?: string | undefined
  readonly ref?: string | undefined
  readonly inputs: Readonly<Record<string, string>>
}

export interface RunWorkflowDispatchOptions {
  // Working dir for the `gh` spawn. Defaults to the repo root (gh resolves the
  // repo from there when `--repo` is not given).
  cwd?: string | undefined
  // Print the equivalent `gh` command and return 0 WITHOUT dispatching. This is
  // a LOCAL dry-run of the dispatch itself — distinct from a workflow's own
  // `publish: false` / `release: false` in-CI dry-run.
  dryRun?: boolean | undefined
  // The spawn executor. Defaults to `gh <args>` via runInherit; injected in
  // tests so no real `gh` call happens.
  exec?: ((args: readonly string[], cwd: string) => Promise<number>) | undefined
}

/**
 * Build the `gh workflow run …` argv for `spec`. Pure — exported for tests.
 * Order: `workflow run <file>`, then `--repo` / `--ref` when set, then one
 * `-f key=value` per input (in insertion order).
 */
export function buildWorkflowRunArgs(spec: WorkflowDispatchSpec): string[] {
  const args = ['workflow', 'run', spec.workflow]
  if (spec.repo) {
    args.push('--repo', spec.repo)
  }
  if (spec.ref) {
    args.push('--ref', spec.ref)
  }
  for (const { 0: key, 1: value } of Object.entries(spec.inputs)) {
    args.push('-f', `${key}=${value}`)
  }
  return args
}

/**
 * One-line human rendering of the equivalent shell command. Pure — used in the
 * dispatch log line and the dry-run preview.
 */
export function formatDispatchPlan(spec: WorkflowDispatchSpec): string {
  return `gh ${buildWorkflowRunArgs(spec).join(' ')}`
}

async function defaultExec(
  args: readonly string[],
  cwd: string,
): Promise<number> {
  return await runInherit('gh', [...args], cwd)
}

/**
 * Dispatch `spec` via `gh workflow run`. Fail-soft: returns the `gh` exit code
 * (the caller maps a non-zero onto process.exitCode); a thrown spawn error is
 * logged and collapses to exit 1. A `dryRun` prints the plan and returns 0
 * without spawning `gh`.
 */
export async function runWorkflowDispatch(
  spec: WorkflowDispatchSpec,
  options?: RunWorkflowDispatchOptions | undefined,
): Promise<number> {
  const opts = { __proto__: null, ...options } as RunWorkflowDispatchOptions
  const cwd = opts.cwd ?? rootPath
  const exec = opts.exec ?? defaultExec
  const plan = formatDispatchPlan(spec)
  if (opts.dryRun) {
    logger.log(`[dry-run] ${plan}`)
    logger.log('  Re-run without --dry-run to dispatch the workflow.')
    return 0
  }
  logger.log(`Dispatching: ${plan}`)
  try {
    const code = await exec(buildWorkflowRunArgs(spec), cwd)
    if (code === 0) {
      logger.success(
        `Dispatched ${spec.workflow}. Track it with \`gh run watch\` ` +
          `(or the repo's Actions tab).`,
      )
    } else {
      logger.fail(
        `\`gh workflow run ${spec.workflow}\` exited ${code}. ` +
          `Check \`gh auth status\` and that the workflow exists on the ref.`,
      )
    }
    return code
  } catch (e) {
    logger.error(errorMessage(e))
    return 1
  }
}
