/**
 * @fileoverview Helper script to prepare package.json for publishing.
 * Handles removing private field and optionally setting version.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const packagePath = args[0]
const version = args[1]

if (!packagePath) {
  console.error(
    'Usage: prepare-package-for-publish.mjs <package-path> [version]',
  )
  process.exit(1)
}

const pkgPath = resolve(packagePath, 'package.json')

try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

  // Remove private field.
  delete pkg.private

  // Set version if provided.
  if (version) {
    pkg.version = version
    console.log(`Set ${pkg.name} version to ${version}`)
  }

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`Prepared ${pkg.name} for publishing`)
} catch (error) {
  console.error(`Error preparing package: ${error.message}`)
  process.exit(1)
}
