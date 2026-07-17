/**
 * @file Fleet lint: run actionlint over `.github/workflows/*.{yml,yaml}`.
 *   Gracefully skips when actionlint is not on PATH (install via
 *   `pnpm run setup-security-tools`). Exits non-zero on any violation.
 *   Usage:
 *   node scripts/fleet/lint-actions.mts           # lint all workflows
 *   node scripts/fleet/lint-actions.mts --quiet   # suppress progress output.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { whichSync } from '@socketsecurity/lib-stable/bin/which'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

function log(
  msg: string,
  options?: { quiet?: boolean | undefined } | undefined,
): void {
  const opts = { __proto__: null, ...options } as {
    quiet?: boolean | undefined
  }
  if (!opts.quiet) {
    logger.log(msg)
  }
}

export function main(): void {
  const args = process.argv.slice(2)
  const quiet = args.includes('--quiet') || args.includes('--silent')

  const workflowsDir = path.join(REPO_ROOT, '.github', 'workflows')
  if (!existsSync(workflowsDir)) {
    log('No .github/workflows directory found; skipping actionlint.', {
      quiet,
    })
    return
  }

  const bin = whichSync('actionlint', { nothrow: true })
  if (!bin || typeof bin !== 'string') {
    log(
      'actionlint not on PATH — skipping. Run `pnpm run setup-security-tools` to install.',
      { quiet },
    )
    return
  }

  log('Running actionlint on .github/workflows/…', { quiet })
  // actionlint invoked with no file args auto-discovers .github/workflows/
  // from the nearest parent directory — exactly the right scope here.
  const result = spawnSync(bin, [], {
    cwd: REPO_ROOT,
    stdio: quiet ? 'pipe' : 'inherit',
  })
  if (result.status !== 0) {
    if (quiet && result.stdout) {
      logger.log(String(result.stdout))
    }
    process.exitCode = 1
    return
  }
  log('actionlint passed.', { quiet })
}

if (isMainModule(import.meta.url)) {
  main()
}
