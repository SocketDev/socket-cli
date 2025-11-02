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
 * Check if content contains bundled code that should be external.
 * Looks for signs that dependencies were bundled inline instead of kept external.
 */
function checkForBundledDependencies(content: string): {
  bundledDeps: string[]
  hasNoBundledDeps: boolean
} {
  // Dependencies that should remain external (not bundled inline).
  // We check if their package code is bundled by looking for their exports.
  const externalDeps = [
    {
      name: '@socketsecurity/registry',
      // Look for characteristic exports from this package.
      pattern: /\/\/ @socketsecurity\/registry/,
    },
  ]

  const bundledDeps: string[] = []

  for (const dep of externalDeps) {
    // If we find evidence that the package's code is bundled inline.
    if (dep.pattern.test(content)) {
      bundledDeps.push(dep.name)
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

  it('should not bundle external dependencies inline', async () => {
    const cliPath = path.join(buildPath, 'cli.js')
    const content = await fs.readFile(cliPath, 'utf8')

    const result = checkForBundledDependencies(content)

    if (!result.hasNoBundledDeps) {
      console.error('Found bundled code from external dependencies:')
      for (const dep of result.bundledDeps) {
        console.error(`  - ${dep}`)
      }
    }

    expect(
      result.hasNoBundledDeps,
      'External dependencies should not be bundled inline',
    ).toBe(true)
  })
})
