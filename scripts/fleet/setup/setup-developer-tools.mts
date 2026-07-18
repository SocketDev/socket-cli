#!/usr/bin/env node
/**
 * @file `setup:developer-tools` — offer a macOS-only, explicit opt-in to add
 *   the current terminal to Developer Tools. macOS applies this exemption to
 *   every process the terminal launches; it cannot be scoped to compiler
 *   output or SFW alone. On macOS CI it enables the exemption automatically;
 *   interactive local setup defaults to enabling it.
 */

import process from 'node:process'

import { getCI } from '@socketsecurity/lib-stable/env/ci'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { confirm } from '@socketsecurity/lib/stdio/prompts'

import { isMainModule } from '../_shared/is-main-module.mts'
import { resolveEcosystemOptions, skipResult } from './ecosystems.mts'

import type {
  EcosystemStepOptions,
  EcosystemStepResult,
} from './ecosystems.mts'

const logger = getDefaultLogger()

async function promptForDeveloperTools(): Promise<boolean> {
  return (await confirm({
    default: true,
    message:
      'macOS Developer Tools can speed up local compiler/test loops by ' +
      'excluding processes started by this terminal from XProtect checks. ' +
      'This also applies to every other process launched by the terminal, ' +
      'including SFW. This changes your local security posture. Enable it?',
  })) as boolean
}

/**
 * Offer the opt-in only on an interactive macOS developer machine. The command
 * opens the System Settings enrollment path; the developer must still enable
 * their terminal there and restart it before the change takes effect.
 */
export async function setupDeveloperTools(
  options?: EcosystemStepOptions | undefined,
): Promise<EcosystemStepResult> {
  const {
    logger: setupLogger,
    platform,
    runCommand,
  } = resolveEcosystemOptions(options)
  if (platform !== 'darwin') {
    return skipResult(setupLogger, 'setup:developer-tools', 'non-macOS host')
  }
  const isCI = getCI()
  if (!isCI && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    return skipResult(
      setupLogger,
      'setup:developer-tools',
      'no interactive terminal',
    )
  }
  if (!isCI && !(await promptForDeveloperTools())) {
    return skipResult(
      setupLogger,
      'setup:developer-tools',
      'developer declined',
    )
  }

  setupLogger.log(
    'setup:developer-tools — requesting macOS Developer Tools enrollment',
  )
  const enrolled = await runCommand('sudo', [
    'spctl',
    'developer-mode',
    'enable-terminal',
  ])
  if (enrolled.exitCode !== 0) {
    setupLogger.fail(
      'setup:developer-tools: macOS enrollment command failed.\n' +
        `  Saw: sudo spctl developer-mode enable-terminal exited ${enrolled.exitCode}.\n` +
        '  Fix: resolve the macOS prompt or run the command manually, then re-run setup.',
    )
    return {
      ok: false,
      reason: 'Developer Tools enrollment failed',
      skipped: false,
    }
  }
  setupLogger.success(
    isCI
      ? 'Developer Tools enrollment requested for the CI process tree.'
      : 'Developer Tools enrollment requested. In System Settings → Privacy & Security → Developer Tools, enable this terminal, then restart it.',
  )
  return { ok: true, skipped: false }
}

if (isMainModule(import.meta.url)) {
  setupDeveloperTools().then(
    result => {
      if (!result.ok) {
        process.exitCode = 1
      }
    },
    (e: unknown) => {
      logger.error(e)
      process.exitCode = 1
    },
  )
}
