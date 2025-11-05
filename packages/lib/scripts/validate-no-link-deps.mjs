/**
 * @fileoverview Validates that no package.json files contain link: dependencies.
 * Link dependencies are prohibited - use workspace: or catalog: instead.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

/**
 * Find all package.json files in the repository.
 */
async function findPackageJsonFiles(dir) {
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
async function checkPackageJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8')
  const pkg = JSON.parse(content)

  const violations = []

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

  return violations
}

async function main() {
  const packageJsonFiles = await findPackageJsonFiles(rootPath)
  const allViolations = []

  for (const file of packageJsonFiles) {
    const violations = await checkPackageJson(file)
    allViolations.push(...violations)
  }

  if (allViolations.length > 0) {
    console.error('❌ Found link: dependencies (prohibited)')
    console.error('')
    console.error(
      'Use workspace: protocol for monorepo packages or catalog: for centralized versions.',
    )
    console.error('')

    for (const violation of allViolations) {
      const relativePath = path.relative(rootPath, violation.file)
      console.error(`  ${relativePath}`)
      console.error(
        `    ${violation.field}.${violation.package}: "${violation.value}"`,
      )
    }

    console.error('')
    console.error('Replace link: with:')
    console.error('  - workspace: for monorepo packages')
    console.error('  - catalog: for centralized version management')
    console.error('')

    process.exitCode = 1
  } else {
    console.log('✓ No link: dependencies found')
  }
}

main().catch(error => {
  console.error('Validation failed:', error)
  process.exitCode = 1
})
