/**
 * Taze wrapper that errors on provenance downgrades.
 *
 * This script runs taze and parses the output for provenance downgrade warnings.
 * If any provenance downgrades are detected, the script exits with code 1.
 *
 * Usage: node scripts/taze.mjs [taze-args...]
 */

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

function includesProvenanceDowngradeWarning(output) {
  const lowered = output.toString().toLowerCase()
  return (
    lowered.includes('provenance') &&
    (lowered.includes('downgrade') || lowered.includes('warn'))
  )
}

void (async () => {
  // Run with command line arguments.
  const args = process.argv.slice(2)

  const tazePromise = spawn('pnpm', ['taze', ...args], {
    stdio: 'pipe',
    cwd: process.cwd(),
  })

  let hasProvenanceDowngrade = false

  tazePromise.process.stdout.on('data', chunk => {
    process.stdout.write(chunk)
    if (includesProvenanceDowngradeWarning(chunk)) {
      hasProvenanceDowngrade = true
    }
  })

  tazePromise.process.stderr.on('data', chunk => {
    process.stderr.write(chunk)
    if (includesProvenanceDowngradeWarning(chunk)) {
      hasProvenanceDowngrade = true
    }
  })

  tazePromise.process.on('close', () => {
    if (hasProvenanceDowngrade) {
      logger.error()
      logger.fail(
        'ERROR: Provenance downgrade detected! Failing build to maintain security.',
      )
      logger.error(
        '   Configure your dependencies to maintain provenance or exclude problematic packages.',
      )
      // eslint-disable-next-line n/no-process-exit
      process.exit(1)
    }
  })

  await tazePromise
})()
