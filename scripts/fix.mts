/**
 * @fileoverview Monorepo-aware auto-fix script — runs linters, security tools,
 * and config auditors with auto-fix enabled.
 *
 * Steps:
 *   1. `pnpm run lint --fix` — oxlint + oxfmt across affected packages
 *   2. `zizmor --fix .github/` — fix GitHub Actions workflow issues (if .github/ exists)
 *   3. `agentshield scan --fix` — fix Claude config security findings (if .claude/ exists)
 *
 * Usage:
 *   node scripts/fix.mjs [options]
 *
 * Options:
 *   --all      Fix all packages
 *   --changed  Fix packages with changed files (default)
 *   --quiet    Suppress progress output
 *   --staged   Fix packages with staged files
 *   --verbose  Show detailed output
 */

import { existsSync } from 'node:fs'

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printHeader } from '@socketsecurity/lib/stdio/header'

const logger = getDefaultLogger()

/**
 * Resolve the path to a binary, checking global PATH first then node_modules/.bin.
 * Returns undefined if the binary is not found anywhere.
 */
function resolveBin(name: string): string | undefined {
  // spawn will find it on PATH or in node_modules/.bin via pnpm exec.
  // We just need to know if it exists at all.
  try {
    // Check node_modules/.bin (works in pnpm monorepos).
    const localBin = `node_modules/.bin/${name}`
    if (existsSync(localBin)) {
      return localBin
    }
  } catch {}
  return undefined
}

interface SecurityFixOptions {
  args: string[]
  bin: string
  label: string
  quiet: boolean
}

/**
 * Run a security tool with --fix. Non-blocking: logs warnings on failure
 * but does not fail the overall fix run.
 */
async function runSecurityFix({
  args,
  bin,
  label,
  quiet,
}: SecurityFixOptions): Promise<void> {
  if (!quiet) {
    logger.stdout.progress(`Running ${label}...`)
  }
  try {
    const result = await spawn(bin, args, {
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })
    if (!quiet) {
      logger.stdout.clearLine()
      if (result.code === 0) {
        logger.success(`${label} completed`)
      } else {
        // Non-zero exit is not fatal — the tool may have found unfixable issues.
        logger.warn(`${label} exited with code ${result.code}`)
      }
    }
  } catch {
    // Tool crashed or is unavailable — skip gracefully.
    if (!quiet) {
      logger.stdout.clearLine()
      logger.warn(`${label} not available, skipping`)
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      all: { type: 'boolean', default: false },
      changed: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      silent: { type: 'boolean', default: false },
      staged: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
    strict: false,
  })

  const quiet = isQuiet(values)
  const verbose = values.verbose

  try {
    if (!quiet) {
      printHeader('Running Auto-fix')
      logger.log('')
    }

    // ── Step 1: Lint fix ─────────────────────────────────────────────────
    // Delegates to per-package lint scripts (oxlint --fix, oxfmt --write).
    const lintArgs = ['run', 'lint', '--fix']
    if (values.all) {
      lintArgs.push('--all')
    }
    if (values.changed) {
      lintArgs.push('--changed')
    }
    if (values.staged) {
      lintArgs.push('--staged')
    }
    if (quiet) {
      lintArgs.push('--quiet')
    }

    const result = await spawn('pnpm', lintArgs, {
      shell: WIN32,
      stdio: quiet ? 'pipe' : 'inherit',
    })

    if (result.code !== 0) {
      if (!quiet) {
        logger.error('Some lint fixes could not be applied')
      }
      process.exitCode = 1
    }

    // ── Step 2: zizmor ───────────────────────────────────────────────────
    // Fixes GitHub Actions workflow security issues in-place.
    // Only runs if .github/ directory exists (some repos don't have workflows).
    // Uses --fix=safe (default) — only applies fixes that won't change behavior.
    if (existsSync('.github')) {
      await runSecurityFix({
        args: ['--fix', '.github/'],
        bin: 'zizmor',
        label: 'zizmor fix',
        quiet,
      })
    }

    // ── Step 3: AgentShield ──────────────────────────────────────────────
    // Fixes Claude config security findings in-place.
    // Only runs if .claude/ directory exists.
    // Uses --fix which applies safe auto-fixes to settings.json, CLAUDE.md, etc.
    if (existsSync('.claude') && resolveBin('agentshield')) {
      await runSecurityFix({
        args: ['exec', 'agentshield', 'scan', '--fix'],
        bin: 'pnpm',
        label: 'agentshield fix',
        quiet,
      })
    }

    if (!quiet && !process.exitCode) {
      logger.log('')
      logger.success('Auto-fix completed!')
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!quiet) {
      logger.error(`Fix failed: ${message}`)
    }
    if (verbose) {
      logger.error(e)
    }
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
