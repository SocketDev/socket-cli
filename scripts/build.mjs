/**
 * @fileoverview Unified build script - compiles TypeScript and bundles code.
 * Standardized across all socket-* repositories.
 *
 * Usage:
 *   node scripts/build.mjs [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --verbose  Show detailed output
 *   --watch    Watch for changes
 */

import {
  isQuiet,
  isVerbose,
  log,
  printError,
  printFooter,
  printHeader,
  printSuccess,
} from './utils/cli-helpers.mjs'
import { runCommandQuiet, runSequence } from './utils/run-command.mjs'

async function main() {
  const quiet = isQuiet()
  const verbose = isVerbose()
  const watch = process.argv.includes('--watch')

  try {
    if (!quiet) {
      printHeader('Building Project')
    }

    const steps = []

    // Check if TypeScript compilation is needed
    // This will be customized per repo based on presence of tsconfig.json
    const needsTypeScript = await runCommandQuiet('test', [
      '-f',
      'tsconfig.json',
    ]).then(r => r.exitCode === 0)

    if (needsTypeScript) {
      steps.push({
        name: 'TypeScript',
        command: 'pnpm',
        args: watch ? ['exec', 'tsgo', '--watch'] : ['exec', 'tsgo'],
      })
    }

    // Check for custom build scripts
    const packageJson = await import('../package.json', {
      with: { type: 'json' },
    })
      .then(m => m.default)
      .catch(() => ({}))

    if (packageJson.scripts?.['build:custom']) {
      steps.push({
        name: 'Custom Build',
        command: 'pnpm',
        args: ['run', 'build:custom'],
      })
    }

    if (steps.length === 0) {
      if (!quiet) {
        log.info('No build steps configured')
        printFooter()
      }
      return
    }

    // Run build steps
    if (!quiet) {
      log.step(
        `Running ${steps.length} build step${steps.length > 1 ? 's' : ''}...`,
      )
    }

    const results = await Promise.all(
      steps.map(async ({ name, command, args }) => {
        const result = await runCommandQuiet(command, args)
        return { name, ...result }
      }),
    )

    // Check for failures
    const failures = results.filter(r => r.exitCode !== 0)

    if (failures.length > 0) {
      // Show failures
      for (const { name, stdout, stderr } of failures) {
        if (!quiet) {
          log.error(`${name} build failed`)
        }
        if (verbose || failures.length === 1) {
          if (stdout) {
            console.log(stdout)
          }
          if (stderr) {
            console.error(stderr)
          }
        }
      }

      if (!quiet) {
        printError('Build failed')
      }
      process.exitCode = 1
    } else {
      if (!quiet) {
        printSuccess('Build completed')
        printFooter()
      }
    }
  } catch (error) {
    if (!quiet) {
      printError(`Build failed: ${error.message}`)
    }
    if (verbose) {
      console.error(error)
    }
    process.exitCode = 1
  }
}

main().catch(console.error)
