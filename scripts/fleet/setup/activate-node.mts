#!/usr/bin/env node
/*
 * @file Activate the pinned Node for ALL shells — the code-first fix for a
 *   non-interactive shell resolving a stale node. fnm's shell hook is commonly
 *   set up only in an INTERACTIVE rc (`~/.zshrc`), so a non-interactive shell
 *   (a CI step, an editor task, an agent's Bash tool) never sources fnm and
 *   falls back to whatever node wins PATH — e.g. a Homebrew node below the fleet
 *   floor, which then trips "Hook requires Node >= 24". This:
 *     1. installs the `.node-version` pin via fnm (idempotent),
 *     2. makes it the fnm default,
 *     3. idempotently ensures `~/.zshenv` (sourced by EVERY zsh, unlike
 *        `~/.zshrc`) evals `fnm env`, so non-interactive shells resolve the
 *        pinned node too.
 *   Complements ensure-node.mts, which re-execs fleet ENTRYPOINTS under the
 *   pinned node; this fixes raw `node` + the husky/git-hook chain at the shell
 *   level. Run once per machine: `node scripts/fleet/setup/activate-node.mts`.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The line that sources fnm; also the idempotency marker (present → skip).
const FNM_ENV_LINE = 'eval "$(fnm env --shell zsh)"'

// The ~/.zshenv block that sources fnm in EVERY zsh, including non-interactive.
export function fnmActivationBlock(): string {
  return (
    [
      '',
      '# fnm — source in ALL shells (incl. non-interactive; ~/.zshrc is',
      '# interactive-only) so the pinned Node (.node-version) wins PATH over a',
      '# stray Homebrew/system node below the fleet floor.',
      `command -v fnm >/dev/null 2>&1 && ${FNM_ENV_LINE}`,
    ].join('\n') + '\n'
  )
}

// True when the rc text does not already source fnm env (so the block is added
// exactly once).
export function needsFnmActivation(rcContent: string): boolean {
  return !rcContent.includes('fnm env')
}

// Run an fnm subcommand, inheriting stdio. Returns true on exit 0.
async function fnm(args: readonly string[]): Promise<boolean> {
  try {
    await spawn('fnm', [...args], { cwd: REPO_ROOT, stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  if (!(await fnm(['--version']))) {
    logger.fail(
      'What: fnm is not on PATH.\n' +
        '  Where: activate-node setup.\n' +
        '  Fix: install fnm (the fleet Node version manager), then re-run this.',
    )
    process.exitCode = 1
    return
  }

  let pin = ''
  try {
    pin = readFileSync(path.join(REPO_ROOT, '.node-version'), 'utf8').trim()
  } catch {
    pin = ''
  }
  if (!pin) {
    logger.fail(
      'What: no .node-version pin found.\n' +
        '  Where: repo root.\n' +
        '  Fix: ensure .node-version exists (cascaded from the wheelhouse canonical).',
    )
    process.exitCode = 1
    return
  }

  logger.step(`Installing + defaulting Node ${pin} via fnm`)
  await fnm(['install', pin])
  await fnm(['default', pin])

  const zshenv = path.join(os.homedir(), '.zshenv')
  const content = existsSync(zshenv) ? readFileSync(zshenv, 'utf8') : ''
  if (needsFnmActivation(content)) {
    writeFileSync(zshenv, content + fnmActivationBlock(), 'utf8')
    logger.success(
      `Added fnm activation to ${zshenv}. New non-interactive shells now resolve Node ${pin}.`,
    )
  } else {
    logger.info(`${zshenv} already sources fnm — no change.`)
  }
  logger.log('')
  logger.log('Open a new shell (or `source ~/.zshenv`) to pick up the pin.')
}

if (isMainModule(import.meta.url)) {
  void main()
}
