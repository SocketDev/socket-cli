/** @fileoverview Validates test infrastructure to catch issues early before CI. */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { logger } from '@socketsecurity/lib/logger'
import { pEach } from '@socketsecurity/lib/promises'

import constants from './constants.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_DIR = path.join(constants.rootPath, 'test')

const VALIDATION_CHECKS = {
  __proto__: null,
  BUILD_ARTIFACTS: 'build-artifacts',
  IMPORT_SYNTAX: 'import-syntax',
  SNAPSHOT_FILES: 'snapshot-files',
  TEST_STRUCTURE: 'test-structure',
}

/**
 * Get list of test files to validate.
 */
async function getTestFiles() {
  const files = []

  /**
   * Recursively collect test files.
   */
  async function collectFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await collectFiles(fullPath)
      } else if (
        entry.isFile() &&
        /\.test\.(mts|ts|js|mjs)$/.test(entry.name)
      ) {
        files.push(fullPath)
      }
    }
  }

  await collectFiles(TEST_DIR)
  return files
}

/**
 * Validate test file structure and naming.
 */
async function validateTestStructure(testFile) {
  const issues = []
  const relativePath = path.relative(constants.rootPath, testFile)

  // Check naming convention.
  if (!testFile.endsWith('.test.mts')) {
    issues.push({
      type: VALIDATION_CHECKS.TEST_STRUCTURE,
      severity: 'warning',
      message: `Test file should use .test.mts extension: ${relativePath}`,
    })
  }

  // Check if corresponding source file exists for unit tests.
  if (relativePath.includes('test/unit')) {
    const sourceFile = testFile
      .replace('/test/unit/', '/src/')
      .replace('.test.mts', '.mts')

    if (!existsSync(sourceFile)) {
      issues.push({
        type: VALIDATION_CHECKS.TEST_STRUCTURE,
        severity: 'info',
        message: `No corresponding source file found for ${relativePath}`,
      })
    }
  }

  return issues
}

/**
 * Validate import statements in test files.
 */
async function validateImportSyntax(testFile) {
  const issues = []
  const relativePath = path.relative(constants.rootPath, testFile)

  try {
    const content = await fs.readFile(testFile, 'utf8')

    // Check for problematic import patterns.
    const problematicPatterns = [
      {
        pattern: /import .+ from ['"]node:/,
        fix: 'Always use node: prefix for built-in modules',
        severity: 'info',
      },
      {
        pattern: /require\(/,
        fix: 'Use ES modules (import) instead of CommonJS (require)',
        severity: 'warning',
      },
      {
        pattern: /from ['"]\.\.\/..\//,
        fix: 'Avoid excessive relative path traversal',
        severity: 'info',
      },
    ]

    for (const { fix, pattern, severity } of problematicPatterns) {
      if (pattern.test(content)) {
        issues.push({
          type: VALIDATION_CHECKS.IMPORT_SYNTAX,
          severity,
          message: `${fix} in ${relativePath}`,
        })
      }
    }

    // Check for missing @fileoverview.
    if (!content.includes('@fileoverview')) {
      issues.push({
        type: VALIDATION_CHECKS.IMPORT_SYNTAX,
        severity: 'warning',
        message: `Missing @fileoverview header in ${relativePath}`,
      })
    }
  } catch (e) {
    issues.push({
      type: VALIDATION_CHECKS.IMPORT_SYNTAX,
      severity: 'error',
      message: `Failed to read ${relativePath}: ${e.message}`,
    })
  }

  return issues
}

/**
 * Check for orphaned snapshot files.
 */
async function validateSnapshotFiles(testFile) {
  const issues = []
  const relativePath = path.relative(constants.rootPath, testFile)
  const snapshotDir = path.join(path.dirname(testFile), '__snapshots__')

  if (!existsSync(snapshotDir)) {
    return issues
  }

  const testFileName = path.basename(testFile)
  const snapshotFile = path.join(
    snapshotDir,
    testFileName.replace(/\.mts$/, '.mts.snap'),
  )

  if (!existsSync(snapshotFile)) {
    // Check if snapshot directory exists but has no matching snapshot.
    const entries = await fs.readdir(snapshotDir)
    if (entries.length > 0) {
      issues.push({
        type: VALIDATION_CHECKS.SNAPSHOT_FILES,
        severity: 'info',
        message: `Snapshot directory exists but no snapshot for ${relativePath}`,
      })
    }
  }

  return issues
}

/**
 * Validate that required build artifacts exist.
 */
async function validateBuildArtifacts() {
  const issues = []
  const distPath = path.join(constants.rootPath, 'dist')

  if (!existsSync(distPath)) {
    issues.push({
      type: VALIDATION_CHECKS.BUILD_ARTIFACTS,
      severity: 'error',
      message: 'dist/ directory not found. Run pnpm run build:cli first',
    })
    return issues
  }

  // Check for key entry points.
  const requiredArtifacts = [
    'dist/cli.js',
    'dist/npm-cli.js',
    'dist/npx-cli.js',
    'dist/pnpm-cli.js',
    'dist/yarn-cli.js',
  ]

  for (const artifact of requiredArtifacts) {
    const fullPath = path.join(constants.rootPath, artifact)
    if (!existsSync(fullPath)) {
      issues.push({
        type: VALIDATION_CHECKS.BUILD_ARTIFACTS,
        severity: 'error',
        message: `Required build artifact missing: ${artifact}`,
      })
    }
  }

  return issues
}

/**
 * Run all validations for a test file.
 */
async function validateTestFile(testFile) {
  const allIssues = []

  const validations = [
    validateTestStructure(testFile),
    validateImportSyntax(testFile),
    validateSnapshotFiles(testFile),
  ]

  const results = await Promise.all(validations)
  for (const issues of results) {
    allIssues.push(...issues)
  }

  return {
    file: path.relative(constants.rootPath, testFile),
    issues: allIssues,
    hasErrors: allIssues.some(issue => issue.severity === 'error'),
    hasWarnings: allIssues.some(issue => issue.severity === 'warning'),
  }
}

/**
 * Format validation results for display.
 */
function formatResults(results) {
  const errors = []
  const warnings = []
  const infos = []

  for (const result of results) {
    if (result.issues.length === 0) {
      continue
    }

    for (const issue of result.issues) {
      const message = `${result.file}: ${issue.message}`
      if (issue.severity === 'error') {
        errors.push(message)
        logger.fail(message)
      } else if (issue.severity === 'warning') {
        warnings.push(message)
        logger.warn(message)
      } else {
        infos.push(message)
      }
    }
  }

  return { errors, infos, warnings }
}

/**
 * Main validation flow.
 */
async function main() {
  logger.info('Starting test validation...\n')

  // Validate build artifacts first.
  const buildIssues = await validateBuildArtifacts()
  if (buildIssues.some(issue => issue.severity === 'error')) {
    for (const issue of buildIssues) {
      logger.fail(issue.message)
    }
    logger.fail(
      '\nBuild artifacts validation failed. Run build before testing.',
    )
    process.exitCode = 1
    return
  }

  const testFiles = await getTestFiles()
  logger.info(`Found ${testFiles.length} test files to validate\n`)

  const results = []
  await pEach(
    testFiles,
    async file => {
      const result = await validateTestFile(file)
      results.push(result)
    },
    { concurrency: 10 },
  )

  logger.info('\n--- Validation Results ---\n')
  const { errors, infos, warnings } = formatResults(results)

  logger.info('\n--- Summary ---')
  logger.info(`Total test files: ${testFiles.length}`)
  logger.info(`Passed: ${results.filter(r => r.issues.length === 0).length}`)
  logger.info(
    `With warnings: ${results.filter(r => r.hasWarnings && !r.hasErrors).length}`,
  )
  logger.info(`With errors: ${results.filter(r => r.hasErrors).length}`)

  if (errors.length > 0) {
    logger.fail(`\n${errors.length} error(s) found`)
    process.exitCode = 1
  } else if (warnings.length > 0) {
    logger.warn(`\n${warnings.length} warning(s) found`)
    if (infos.length > 0) {
      logger.info(`${infos.length} info message(s)`)
    }
  } else {
    logger.success('\nAll tests validated successfully!')
    if (infos.length > 0) {
      logger.info(`${infos.length} info message(s)`)
    }
  }
}

main().catch(e => {
  logger.fail(`Validation failed: ${e.message}`)
  logger.fail(e.stack)
  process.exitCode = 1
})
