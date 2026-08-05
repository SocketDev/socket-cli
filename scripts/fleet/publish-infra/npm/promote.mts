#!/usr/bin/env node
/*
 * @file Promote a staged package to public, then cut its tag + release.
 *
 *   The gap this fills: a release staged by the npm-publish.yml workflow cannot
 *   be approved by the pipeline's own `--approve`, because that stands on a
 *   bump receipt in the pipeline state file and the receipt lives in the CI run
 *   rather than on the operator's machine. The pipeline is right to refuse. So
 *   the promote goes through the registry directly, and the pipeline picks the
 *   job back up at `--reconcile`, which is exactly the healer for "live on the
 *   registry, missing its tag".
 *
 *   The other half is the terminal. `stage approve` is a 2FA proof-of-presence
 *   step and the prompt gates on `isTTY`, so an agent shell, a cron, and
 *   `! <cmd>` in a chat session all die with ERR_PNPM_OTP_NON_INTERACTIVE
 *   before reaching the registry. Rather than telling the operator to run it
 *   somewhere else, this dispatches through otp-runner: pnpm directly when it
 *   can do web auth without a TTY, `script(1)` when it cannot, npm on a host
 *   with no `script(1)`.
 *
 *   Usage:
 *     node scripts/fleet/publish-infra/npm/promote.mts --version <x.y.z>
 *       [--stage-id <id>]   required until the version is public
 *       [--dry-run]         print the plan and resolved argv, run nothing
 *       [--skip-reconcile]  promote only, leave the tag/release for later
 *
 *   Exit: 0 promoted (or already public); 1 on a missing flag, a failed
 *   promote, or a registry that never served the version.
 */

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { isError } from '@socketsecurity/lib-stable/errors/predicates'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../../_shared/is-main-module.mts'
import { runMain } from '../../_shared/run-main.mts'

import type { ScriptMeta } from '../../_shared/run-main.mts'
import { PACKAGE_JSON, PUBLISH_PIPELINE_SCRIPT } from '../../paths.mts'
import { otpCommand, planOtpRun } from './otp-runner.mts'

const logger = getDefaultLogger()

// How long to wait for the registry to serve the new version. npm reads are
// read-through-cached, so the first read after a promote can still be stale.
// Polling registry TRUTH beats trusting the promote's exit code.
const REGISTRY_POLL_ATTEMPTS = 20
const REGISTRY_POLL_MS = 6000

export function flag(
  argv: readonly string[],
  name: string,
): string | undefined {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}

/**
 * The exit status carried by a rejected spawn, or undefined when the rejection
 * is not an exit at all.
 *
 * `spawn` REJECTS on any non-zero exit rather than resolving with a code, so
 * every call here is wrapped and the status read off the rejection. The
 * `typeof code === 'number'` half matters: a spawn that failed to LAUNCH
 * carries a string `.code` (`'ENOENT'`), and reading that as a status would
 * silently mean the wrong thing.
 *
 * Uses `isError` rather than `isSpawnError`: the PUBLISHED `isSpawnError`
 * accepts any object carrying a `code`, so it would pass a bare `{ code: 1 }`
 * that `spawn` never throws. The tightened one ships in a later release. This
 * form is correct against both, and migrates to `isSpawnExitError` once a
 * release carrying it is public.
 */
export function exitCodeOf(e: unknown): number | undefined {
  if (!isError(e)) {
    return undefined
  }
  const { code } = e as { code?: unknown | undefined }
  return typeof code === 'number' ? code : undefined
}

/**
 * Run a command, returning its exit status rather than throwing. `inherit`
 * keeps the child attached to this process's streams, which is what lets the
 * 2FA prompt render and the browser hand-off work.
 */
export async function runInherit(
  command: string,
  args: readonly string[],
): Promise<number> {
  try {
    await spawn(command, args, { stdio: 'inherit' })
    return 0
  } catch (e) {
    return exitCodeOf(e) ?? 1
  }
}

/**
 * The installed version of `bin`, or undefined when it is absent or unreadable.
 * Undefined is a real answer: otp-runner refuses to credit an unknown build
 * with a capability.
 */
export async function toolVersion(bin: string): Promise<string | undefined> {
  try {
    const result = await spawn(bin, ['--version'], { stdioString: true })
    const text = String(result.stdout ?? '').trim()
    return /^\d+\.\d+/.test(text) ? text : undefined
  } catch {
    return undefined
  }
}

/**
 * The version the registry currently serves for `pkg`, or undefined when the
 * read fails. A failed read is NOT "not published" — callers keep polling.
 */
export async function publishedVersion(
  pkg: string,
): Promise<string | undefined> {
  try {
    const result = await spawn('npm', ['view', pkg, 'version'], {
      // Run outside the repo: npm reads the local manifest's `devEngines` and
      // refuses with EBADDEVENGINES when the running Node is off-pin, which has
      // nothing to do with a registry read.
      cwd: '/tmp',
      stdioString: true,
    })
    return String(result.stdout ?? '').trim() || undefined
  } catch {
    return undefined
  }
}

export async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const version = flag(argv, '--version')
  if (!version) {
    logger.fail('promote: --version <x.y.z> is required.')
    process.exitCode = 1
    return
  }
  const dryRun = argv.includes('--dry-run')
  const pkg = String(JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).name)

  // Already public: nothing to promote, so fall through to the tag step. This
  // is what makes a re-run after a partial failure safe.
  const live = await publishedVersion(pkg)
  if (live === version) {
    logger.info(`promote: ${pkg}@${version} is already public.`)
  } else {
    const stageId = flag(argv, '--stage-id')
    if (!stageId) {
      logger.fail(
        'promote: --stage-id <id> is required until the version is public.',
      )
      logger.info('  Find it with: pnpm stage list')
      process.exitCode = 1
      return
    }

    const plan = planOtpRun({
      hasTty: Boolean(process.stdout.isTTY),
      npmVersion: await toolVersion('npm'),
      platform: process.platform,
      pnpmVersion: await toolVersion('pnpm'),
    })
    if (plan.strategy === 'unavailable') {
      logger.fail(
        `promote: no way to answer the 2FA challenge — ${plan.reason}`,
      )
      process.exitCode = 1
      return
    }
    const resolved = otpCommand(plan, process.platform, [
      'stage',
      'approve',
      stageId,
    ])!
    logger.info(`promote: ${plan.strategy} — ${plan.reason}`)
    logger.info(`  ${resolved.command} ${resolved.args.join(' ')}`)

    if (dryRun) {
      logger.info('promote: dry run — nothing executed.')
      return
    }

    logger.info('promote: a browser will open for the web-OTP challenge…')
    const approveCode = await runInherit(resolved.command, resolved.args)
    if (approveCode !== 0) {
      logger.fail(`promote: the approve exited ${approveCode}.`)
      process.exitCode = 1
      return
    }

    // Registry truth, not the exit status above.
    let served: string | undefined
    for (let i = 0; i < REGISTRY_POLL_ATTEMPTS; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- a poll is sequential by definition.
      served = await publishedVersion(pkg)
      if (served === version) {
        break
      }
      // eslint-disable-next-line no-await-in-loop -- ditto.
      await new Promise(resolve => {
        setTimeout(resolve, REGISTRY_POLL_MS)
      })
    }
    if (served !== version) {
      logger.fail(
        `promote: the registry still serves ${served ?? 'nothing'}; expected ${version}.`,
      )
      logger.info(
        '  Re-run this command — the already-public check makes that safe.',
      )
      process.exitCode = 1
      return
    }
    logger.success(`promote: ${pkg}@${version} is public.`)
  }

  if (argv.includes('--skip-reconcile')) {
    logger.info('promote: --skip-reconcile — leaving the tag + release.')
    return
  }
  if (dryRun) {
    logger.info(`promote: dry run — would reconcile ${version}.`)
    return
  }
  logger.info(`promote: cutting the v${version} tag + GitHub release…`)
  const code = await runInherit(process.execPath, [
    PUBLISH_PIPELINE_SCRIPT,
    '--reconcile',
    version,
  ])
  if (code !== 0) {
    process.exitCode = 1
  }
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'promotes a staged npm package to public, then cuts its tag and GitHub release',
  help: `Usage: node scripts/fleet/publish-infra/npm/promote.mts [flags]
  --version <x.y.z>   the staged version to promote
  --stage-id <id>     select a specific stage record
  --dry-run           print the plan; no registry writes
  --skip-reconcile    skip the post-promote release-gap reconcile`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
