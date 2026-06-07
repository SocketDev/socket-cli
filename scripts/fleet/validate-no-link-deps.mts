#!/usr/bin/env node
/**
 * @file Validates that no package.json files contain link: dependencies. Link
 *   dependencies are prohibited - use workspace: or catalog: instead.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const rootPath = REPO_ROOT

/**
 * Find all package.json files in the repository.
 */
async function findPackageJsonFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const fullPath = path.join(dir, entry.name)

    // Skip node_modules, .git, and build directories.
    if (
      entry.name === '.git' ||
      entry.name === 'build' ||
      entry.name === 'dist' ||
      entry.name === 'node_modules'
    ) {
      continue
    }

    if (entry.isDirectory()) {
      files.push(...(await findPackageJsonFiles(fullPath)))
    } else if (entry.name === 'package.json') {
      files.push(fullPath)
    }
  }

  return files
}

interface LinkViolation {
  file: string
  field: string
  package: string
  value: string
}

/**
 * Check if a package.json contains link: dependencies.
 */
async function checkPackageJson(filePath: string): Promise<LinkViolation[]> {
  const content = await fs.readFile(filePath, 'utf8')
  let pkg: Record<string, Record<string, string> | undefined>
  try {
    pkg = JSON.parse(content) as Record<
      string,
      Record<string, string> | undefined
    >
  } catch (e) {
    throw new Error(
      `Failed to parse ${filePath}: ${e instanceof Error ? e.message : 'Unknown error'}`,
      { cause: e },
    )
  }

  const violations: LinkViolation[] = []

  // Check dependencies.
  if (pkg['dependencies']) {
    for (const [name, version] of Object.entries(pkg['dependencies'])) {
      if (typeof version === 'string' && version.startsWith('link:')) {
        violations.push({
          file: filePath,
          field: 'dependencies',
          package: name,
          value: version,
        })
      }
    }
  }

  // Check devDependencies.
  if (pkg['devDependencies']) {
    for (const [name, version] of Object.entries(pkg['devDependencies'])) {
      if (typeof version === 'string' && version.startsWith('link:')) {
        violations.push({
          file: filePath,
          field: 'devDependencies',
          package: name,
          value: version,
        })
      }
    }
  }

  // Check peerDependencies.
  if (pkg['peerDependencies']) {
    for (const [name, version] of Object.entries(pkg['peerDependencies'])) {
      if (typeof version === 'string' && version.startsWith('link:')) {
        violations.push({
          file: filePath,
          field: 'peerDependencies',
          package: name,
          value: version,
        })
      }
    }
  }

  // Check optionalDependencies.
  if (pkg['optionalDependencies']) {
    for (const [name, version] of Object.entries(pkg['optionalDependencies'])) {
      if (typeof version === 'string' && version.startsWith('link:')) {
        violations.push({
          file: filePath,
          field: 'optionalDependencies',
          package: name,
          value: version,
        })
      }
    }
  }

  return violations
}

async function main(): Promise<void> {
  const packageJsonFiles = await findPackageJsonFiles(rootPath)
  const allViolations: LinkViolation[] = []

  for (let i = 0, { length } = packageJsonFiles; i < length; i += 1) {
    const file = packageJsonFiles[i]!
    const violations = await checkPackageJson(file)
    allViolations.push(...violations)
  }

  if (allViolations.length > 0) {
    logger.fail('Found link: dependencies (prohibited)')
    logger.error('')
    logger.error(
      'Use workspace: protocol for monorepo packages or catalog: for centralized versions.',
    )
    logger.error('')

    for (let i = 0, { length } = allViolations; i < length; i += 1) {
      const violation = allViolations[i]!
      const relativePath = path.relative(rootPath, violation.file)
      logger.error(`  ${relativePath}`)
      logger.error(
        `    ${violation.field}.${violation.package}: "${violation.value}"`,
      )
    }

    logger.error('')
    logger.error('Replace link: with:')
    logger.error('  - workspace: for monorepo packages')
    logger.error('  - catalog: for centralized version management')
    logger.error('')

    process.exitCode = 1
  } else {
    logger.success('No link: dependencies found')
  }
}

main().catch((e: unknown) => {
  logger.error('Validation failed:', e)
  process.exitCode = 1
})
