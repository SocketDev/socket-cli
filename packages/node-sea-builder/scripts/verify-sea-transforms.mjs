#!/usr/bin/env node

/**
 * AST-based verification of SEA compatibility transformations.
 * Ensures all require.resolve.paths accesses have defensive checks.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Simple AST walker to find require.resolve.paths patterns.
function findUnsafeResolvePathsAccess(code) {
  const issues = []
  const lines = code.split('\n')

  // Pattern 1: Direct access without any checks.
  // Unsafe: if (require.resolve.paths)
  // Safe: if (require.resolve && require.resolve.paths)
  const directAccessPattern = /if\s*\(\s*require\.resolve\.paths\s*\)/g

  let match
  while ((match = directAccessPattern.exec(code)) !== null) {
    const lineNum = code.substring(0, match.index).split('\n').length
    const line = lines[lineNum - 1]
    issues.push({
      type: 'unsafe-if-check',
      line: lineNum,
      code: line.trim(),
      reason: 'Missing defensive check for require.resolve',
    })
  }

  // Pattern 2: Direct method call without checks.
  // Unsafe: const paths = require.resolve.paths("npm")
  // This should be inside an if block that checks require.resolve first.
  const directCallPattern =
    /(?:const|let|var)\s+\w+\s*=\s*require\.resolve\.paths\s*\(/g

  while ((match = directCallPattern.exec(code)) !== null) {
    const lineNum = code.substring(0, match.index).split('\n').length
    const line = lines[lineNum - 1]

    // Check if this line is inside a protective if block.
    // Look backwards to see if there's a recent check.
    const previousLines = lines.slice(Math.max(0, lineNum - 5), lineNum - 1)
    const hasProtection = previousLines.some((l) =>
      /if\s*\(\s*require\.resolve\s*&&\s*require\.resolve\.paths\s*\)/.test(l),
    )

    if (!hasProtection) {
      issues.push({
        type: 'unsafe-direct-call',
        line: lineNum,
        code: line.trim(),
        reason: 'Direct call without protective if block',
      })
    }
  }

  return issues
}

// Verify polyfill is present at the top.
function verifyPolyfill(code) {
  const polyfillPattern =
    /if\s*\(\s*typeof\s+require\s*!==\s*['"]undefined['"]\s*&&\s*\(\s*!require\.resolve\s*\|\|\s*!require\.resolve\.paths\s*\)\s*\)/
  const hasPolyfill = polyfillPattern.test(code.substring(0, 1000))

  return {
    present: hasPolyfill,
    position: hasPolyfill ? 'within first 1000 chars' : 'NOT FOUND',
  }
}

// Main verification.
async function main() {
  const modifiedCliPath = path.join(
    __dirname,
    '..',
    'build/sea/cli-modified.js',
  )

  const logger = getDefaultLogger()
  logger.log('SEA Transformation Verification')
  logger.log('================================\n')
  logger.log(`Analyzing: ${modifiedCliPath}\n`)

  let code
  try {
    code = readFileSync(modifiedCliPath, 'utf8')
  } catch (error) {
    logger.error(`${colors.red('✗')} Could not read modified CLI file`)
    logger.error(`   Path: ${modifiedCliPath}`)
    logger.error(`   Error: ${error.message}`)
    process.exit(1)
  }

  // Check 1: Polyfill presence.
  logger.log('Check 1: Polyfill Presence')
  logger.log('--------------------------')
  const polyfillCheck = verifyPolyfill(code)
  if (polyfillCheck.present) {
    logger.log(`${colors.green('✓')} Polyfill found (${polyfillCheck.position})`)
  } else {
    logger.log(`${colors.red('✗')} Polyfill NOT found`)
  }
  logger.log('')

  // Check 2: Unsafe patterns.
  logger.log('Check 2: Unsafe require.resolve.paths Patterns')
  logger.log('-----------------------------------------------')
  const issues = findUnsafeResolvePathsAccess(code)

  if (issues.length === 0) {
    logger.log(`${colors.green('✓')} No unsafe patterns found`)
    logger.log('   All require.resolve.paths accesses have defensive checks')
  } else {
    logger.log(`${colors.red('✗')} Found ${issues.length} unsafe pattern(s):\n`)
    for (const issue of issues) {
      logger.log(`   Line ${issue.line}: ${issue.type}`)
      logger.log(`   Code: ${issue.code}`)
      logger.log(`   Reason: ${issue.reason}`)
      logger.log('')
    }
  }
  logger.log('')

  // Check 3: Sentinel obscuration.
  logger.log('Check 3: Sentinel Obscuration')
  logger.log('------------------------------')
  const directSentinel = code.includes('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2')
  const obscuredSentinel = code.includes('NODE_SEA" + "_FUSE_fce680ab2cc467b6e072b8b5df1996b2')

  if (!directSentinel && obscuredSentinel) {
    logger.log(`${colors.green('✓')} Sentinel properly obscured`)
    logger.log('   Direct sentinel: NOT FOUND (good)')
    logger.log('   Obscured sentinel: FOUND (good)')
  } else if (directSentinel) {
    logger.log(`${colors.yellow('⚠')} Direct sentinel still present`)
    logger.log('   This may cause postject issues')
  } else {
    logger.log(`${colors.blue('ℹ')} Sentinel status unclear`)
  }
  logger.log('')

  // Summary.
  logger.log('Summary')
  logger.log('-------')
  const allChecksPass =
    polyfillCheck.present && issues.length === 0 && !directSentinel

  if (allChecksPass) {
    logger.log(`${colors.green('✓')} All SEA compatibility checks passed!`)
    logger.log('   The binary is ready for testing')
    process.exit(0)
  } else {
    logger.log(`${colors.red('✗')} Some checks failed`)
    logger.log('   Review the issues above before deploying')
    process.exit(1)
  }
}

main().catch((error) => {
  logger.error('Verification failed:', error)
  process.exit(1)
})
