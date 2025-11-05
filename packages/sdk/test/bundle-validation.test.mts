/**
 * @fileoverview Bundle validation tests to ensure build output quality.
 * Verifies that dist files don't contain absolute paths or external dependencies.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packagePath = path.resolve(__dirname, '..')
const distPath = path.join(packagePath, 'dist')

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
 * Check if bundle contains inlined dependencies using AST analysis.
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

  // Parse the bundle into an AST.
  const file = parse(content, {
    sourceType: 'module',
    plugins: ['typescript'],
  })

  // Collect all import sources from the AST.
  const importSources = new Set<string>()

  traverse(file as any, {
    ImportDeclaration(path: any) {
      const source = path.node.source.value
      importSources.add(source)
    },
  })

  // Packages that should always be external (never bundled).
  const socketPackagePatterns = [
    /@socketsecurity\/lib/,
    /@socketregistry\/packageurl-js/,
    /@socketsecurity\/sdk/,
    /@socketsecurity\/registry/,
  ]

  // Check if we have runtime dependencies.
  if (Object.keys(dependencies).length === 0) {
    // No runtime dependencies - check that Socket packages aren't bundled.
    for (const pattern of socketPackagePatterns) {
      const hasExternalImport = Array.from(importSources).some(source =>
        pattern.test(source),
      )

      if (!hasExternalImport) {
        // Check if this package name appears in the content at all.
        // If it's just in string literals (like constants), that's fine.
        // Use AST to check if it appears in any meaningful way.
        let foundInCode = false

        traverse(file as any, {
          StringLiteral(path: any) {
            // Skip string literals - these are fine
            if (pattern.test(path.node.value)) {
              // It's in a string literal, which is fine
            }
          },

          Identifier(path: any) {
            // Check if the package name appears in identifiers or other code
            if (
              pattern.test(path.node.name) ||
              (path.node.name.includes('socketsecurity') &&
                pattern.test(path.node.name))
            ) {
              foundInCode = true
            }
          },
        })

        // Only flag if we found it in actual code, not just string literals
        if (foundInCode) {
          bundledDeps.push(pattern.source)
        }
      }
    }
  } else {
    // We have runtime dependencies - check that they remain external.
    for (const dep of Object.keys(dependencies)) {
      const hasExternalImport = importSources.has(dep)

      if (!hasExternalImport) {
        // Dependency isn't imported externally - it might be bundled
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
  it('should not contain absolute paths in dist/index.js', async () => {
    const indexPath = path.join(distPath, 'index.js')
    const content = await fs.readFile(indexPath, 'utf8')

    const result = hasAbsolutePaths(content)

    if (result.hasIssue) {
      console.error('Found absolute paths in bundle:')
      for (const match of result.matches) {
        console.error(`  - ${match}`)
      }
    }

    expect(result.hasIssue, 'Bundle should not contain absolute paths').toBe(
      false,
    )
  })

  it('should not bundle dependencies inline (validate against package.json dependencies)', async () => {
    const indexPath = path.join(distPath, 'index.js')
    const content = await fs.readFile(indexPath, 'utf8')

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
