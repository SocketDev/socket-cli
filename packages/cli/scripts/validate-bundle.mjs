/**
 * @fileoverview Validates that the CLI bundle doesn't contain unresolved external dependencies.
 *
 * Rules:
 * - No require("./external/<package>") calls should exist in the bundle.
 * - All socket-lib external dependencies should be inlined.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const buildPath = path.join(__dirname, '..', 'build', 'cli.js')

/**
 * Validate that the bundle doesn't contain unresolved external requires.
 */
function validateBundle() {
  let content
  try {
    content = readFileSync(buildPath, 'utf8')
  } catch (error) {
    logger.fail(`Failed to read bundle: ${error.message}`)
    return false
  }

  const violations = []

  // Check for require("./external/<package>") patterns.
  const externalRequirePattern = /require\(["']\.\/external\/([^"']+)["']\)/g
  let match
  while ((match = externalRequirePattern.exec(content)) !== null) {
    violations.push({
      pattern: match[0],
      package: match[1],
      type: 'unresolved-external-require',
    })
  }

  return violations
}

async function main() {
  try {
    const violations = validateBundle()

    if (violations.length === 0) {
      logger.success('Bundle validation passed')
      process.exitCode = 0
      return
    }

    logger.fail('Bundle validation failed')
    logger.log('')
    logger.log('Found unresolved external requires:')
    logger.log('')

    for (const violation of violations) {
      logger.log(`  ${violation.pattern}`)
      logger.log(`    Package: ${violation.package}`)
      logger.log(`    Type: ${violation.type}`)
      logger.log('')
    }

    logger.log(
      'These require() calls reference relative paths that will fail at runtime.',
    )
    logger.log(
      'Socket-lib external dependencies should be bundled into the CLI.',
    )
    logger.log('')

    process.exitCode = 1
  } catch (error) {
    logger.fail(`Validation failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(`Validation failed: ${error}`)
  process.exitCode = 1
})
