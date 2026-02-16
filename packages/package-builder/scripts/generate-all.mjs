/**
 * @fileoverview Generate all package directories from templates.
 * Runs all package generation scripts in sequence.
 *
 * Usage:
 *   node scripts/generate-all.mjs.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logger = getDefaultLogger()

/**
 * Run a script and report results.
 */
async function runScript(scriptName, description) {
  logger.log(`\n▶ ${description}...`)
  logger.log('─'.repeat(50))

  const result = await spawn('node', [path.join(__dirname, scriptName)], {
    cwd: path.dirname(__dirname),
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    const error = new Error(
      `${scriptName} failed with exit code ${result.code}. Check output above for details.`,
    )
    if (result.stderr) {
      error.message += `\nStderr: ${result.stderr}`
    }
    throw error
  }

  logger.success(`✓ ${description} complete`)
}

/**
 * Main generation logic.
 */
async function main() {
  logger.log('')
  logger.log('═'.repeat(50))
  logger.log('Generating all packages from templates')
  logger.log('═'.repeat(50))

  // Run all generation scripts in sequence.
  await runScript('generate-cli-packages.mjs', 'CLI packages')
  await runScript('generate-socketbin-packages.mjs', 'Socketbin packages')

  logger.log('')
  logger.log('═'.repeat(50))
  logger.success('All packages generated successfully!')
  logger.log('═'.repeat(50))
  logger.log('')
}

main().catch(e => {
  logger.log('')
  logger.error('Package generation failed:', e.message)
  process.exitCode = 1
})
