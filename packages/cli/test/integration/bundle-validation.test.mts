/**
 * @fileoverview Bundle validation tests to ensure build output quality.
 * Verifies that dist files don't contain absolute paths or unexpected bundled dependencies.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packagePath = path.resolve(__dirname, '..', '..')
const buildPath = path.join(packagePath, 'build')

/**
 * Check if content contains absolute paths.
 * Detects paths like /Users/, C:\, /home/, etc.
 */
function hasAbsolutePaths(content: string): {
  hasIssue: boolean
  matches: string[]
} {
  // Match absolute paths but exclude URLs and node: protocol.
  const patterns = [
    // Match require('/abs/path') or require('C:\\path').
    /require\(["'](?:\/[^"'\n]+|[A-Z]:\\[^"'\n]+)["']\)/g,
    // Match import from '/abs/path'.
    /import\s+.*?from\s+["'](?:\/[^"'\n]+|[A-Z]:\\[^"'\n]+)["']/g,
  ]

  const matches: string[] = []
  for (const pattern of patterns) {
    const found = content.match(pattern)
    if (found) {
      matches.push(...found)
    }
  }

  return {
    hasIssue: matches.length > 0,
    matches,
  }
}

/**
 * Check if bundle contains inlined dependencies.
 * Reads package.json dependencies and ensures they are NOT bundled inline.
 */
async function checkBundledDependencies(content: string): Promise<{
  bundledDeps: string[]
  hasNoBundledDeps: boolean
}> {
  // Read package.json to get runtime dependencies.
  const pkgJsonPath = path.join(packagePath, 'package.json')
  const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'))
  const dependencies = pkgJson.dependencies || {}

  const bundledDeps: string[] = []

  // If we have NO dependencies, check that no external packages are bundled.
  if (Object.keys(dependencies).length === 0) {
    // Look for signs of bundled npm packages.
    // Bundled packages often have characteristic patterns like:
    // - var xxx_exports = {};
    // - __toCommonJS(package_name_exports)
    // - Multiple functions from same package bundled together.
    const bundledPackagePatterns = [
      // Socket packages that should always be external.
      /@socketsecurity\/registry/,
    ]

    for (const pattern of bundledPackagePatterns) {
      // Check if package name appears in context that suggests bundling.
      // Look for: var import_package = require("package") without the actual require call.
      // This would indicate the package code is bundled inline.
      const bundlePattern = new RegExp(
        `var\\s+\\w+\\s*=\\s*__toCommonJS\\([^)]*${pattern.source}`,
      )

      if (bundlePattern.test(content)) {
        bundledDeps.push(pattern.source)
      }
    }
  } else {
    // If we have dependencies, check that they remain external (not bundled).
    for (const dep of Object.keys(dependencies)) {
      const escapedDep = dep.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')
      // Check if dependency code is bundled by looking for __toCommonJS pattern.
      const bundlePattern = new RegExp(
        `var\\s+\\w+\\s*=\\s*__toCommonJS\\([^)]*${escapedDep}`,
      )

      if (bundlePattern.test(content)) {
        bundledDeps.push(dep)
      }
    }
  }

  return {
    bundledDeps,
    hasNoBundledDeps: bundledDeps.length === 0,
  }
}

describe('Bundle validation', () => {
  it('should not contain absolute paths in build/cli.js', async () => {
    const cliPath = path.join(buildPath, 'cli.js')
    const content = await fs.readFile(cliPath, 'utf8')

    const result = hasAbsolutePaths(content)

    if (result.hasIssue) {
      console.error('Found absolute paths in bundle:')
      for (const match of result.matches) {
        console.error(`  - ${match}`)
      }
    }

    expect(
      result.hasIssue,
      'Bundle should not contain absolute paths',
    ).toBe(false)
  })

  it('should not bundle dependencies inline (validate against package.json dependencies)', async () => {
    const cliPath = path.join(buildPath, 'cli.js')
    const content = await fs.readFile(cliPath, 'utf8')

    const result = await checkBundledDependencies(content)

    if (!result.hasNoBundledDeps) {
      console.error('Found bundled dependencies (should be external):')
      for (const dep of result.bundledDeps) {
        console.error(`  - ${dep}`)
      }
    }

    expect(
      result.hasNoBundledDeps,
      'Dependencies from package.json should be external, not bundled inline',
    ).toBe(true)
  })
})
