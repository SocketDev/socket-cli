/**
 * @fileoverview Validates that no package.json files contain link: dependencies.
 * Link dependencies are prohibited - use workspace: or catalog: instead.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

interface LinkViolation {
  file: string
  field: string
  package: string
  value: string
}

/**
 * Find all package.json files in the repository.
 */
async function findPackageJsonFiles(dir: string): Promise<string[]> {
  const files = []
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    // Skip node_modules, .git, and build directories.
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'build' ||
      entry.name === 'dist'
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

/**
 * Check if a package.json contains link: dependencies.
 */
async function checkPackageJson(filePath: string): Promise<LinkViolation[]> {
  const content = await fs.readFile(filePath, 'utf8')
  const pkg = JSON.parse(content)

  const violations: LinkViolation[] = []

  // Check dependencies.
  if (pkg.dependencies) {
    for (const [name, version] of Object.entries(pkg.dependencies)) {
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
  if (pkg.devDependencies) {
    for (const [name, version] of Object.entries(pkg.devDependencies)) {
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
  if (pkg.peerDependencies) {
    for (const [name, version] of Object.entries(pkg.peerDependencies)) {
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
  if (pkg.optionalDependencies) {
    for (const [name, version] of Object.entries(pkg.optionalDependencies)) {
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

  // Check pnpm.overrides.
  if (pkg.pnpm?.overrides) {
    for (const [name, version] of Object.entries(pkg.pnpm.overrides)) {
      if (typeof version === 'string' && version.startsWith('link:')) {
        violations.push({
          file: filePath,
          field: 'pnpm.overrides',
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

  for (const file of packageJsonFiles) {
    const violations = await checkPackageJson(file)
    allViolations.push(...violations)
  }

  if (allViolations.length > 0) {
    logger.error('❌ Found link: dependencies (prohibited)')
    logger.log('')
    logger.error(
      'Use workspace: protocol for monorepo packages or catalog: for centralized versions.',
    )
    logger.log('')

    for (const violation of allViolations) {
      const relativePath = path.relative(rootPath, violation.file)
      logger.error(`  ${relativePath}`)
      logger.error(
        `    ${violation.field}.${violation.package}: "${violation.value}"`,
      )
    }

    logger.log('')
    logger.error('Replace link: with:')
    logger.error('  - workspace: for monorepo packages')
    logger.error('  - catalog: for centralized version management')
    logger.log('')

    process.exitCode = 1
  } else {
    logger.success('No link: dependencies found')
  }
}

main().catch((e: unknown) => {
  logger.error('Validation failed:', e)
  process.exitCode = 1
})
