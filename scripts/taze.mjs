/**
 * Taze wrapper that errors on provenance downgrades.
 *
 * This script runs taze and parses the output for provenance downgrade warnings.
 * If any provenance downgrades are detected, the script exits with code 1.
 *
 * Usage: node scripts/taze.mjs [taze-args...]
 */

import { spawn } from 'node:child_process'

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

  const tazeProcess = spawn('pnpm', ['taze', ...args], {
    stdio: 'pipe',
    cwd: process.cwd(),
  })

  let hasProvenanceDowngrade = false

  tazeProcess.stdout.on('data', chunk => {
    process.stdout.write(chunk)
    if (includesProvenanceDowngradeWarning(chunk)) {
      hasProvenanceDowngrade = true
    }
  })

  tazeProcess.stderr.on('data', chunk => {
    process.stderr.write(chunk)
    if (includesProvenanceDowngradeWarning(chunk)) {
      hasProvenanceDowngrade = true
    }
  })

  tazeProcess.on('close', () => {
    if (hasProvenanceDowngrade) {
      console.error('')
      console.error(
        'ERROR: Provenance downgrade detected! Failing build to maintain security.',
      )
      console.error(
        '   Configure your dependencies to maintain provenance or exclude problematic packages.',
      )
      // eslint-disable-next-line n/no-process-exit
      process.exit(1)
    }
  })

  // Wait for process to complete
  await new Promise((resolve) => {
    tazeProcess.on('exit', resolve)
  })
})()
