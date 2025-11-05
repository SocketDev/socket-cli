#!/usr/bin/env node
/**
 * @fileoverview SDK generation script.
 * Orchestrates the complete SDK generation process:
 * 1. Prettifies the OpenAPI JSON
 * 2. Generates TypeScript types from OpenAPI
 * 3. Formats and lints the generated code
 *
 * Usage:
 *   node scripts/generate-sdk.mjs
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as parser from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'
import MagicString from 'magic-string'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { getRootPath } from './utils/path-helpers.mjs'
import { runCommand } from './utils/run-command.mjs'

const rootPath = getRootPath(import.meta.url)
const typesPath = resolve(rootPath, 'types/api.d.ts')

// Initialize logger
const logger = getDefaultLogger()

async function generateTypes() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['scripts/generate-types.mjs'], {
      cwd: rootPath,
      stdio: ['inherit', 'pipe', 'inherit'],
    })

    let output = ''

    child.stdout.on('data', data => {
      output += data.toString()
    })

    child.on('exit', code => {
      if (code !== 0) {
        reject(new Error(`Type generation failed with exit code ${code}`))
        return
      }

      try {
        writeFileSync(typesPath, output, 'utf8')
        // Fix array syntax after writing to disk
        fixArraySyntax(typesPath)
        // Add SDK v3 method name aliases
        addSdkMethodAliases(typesPath)
        resolve()
      } catch (error) {
        reject(error)
      }
    })

    child.on('error', reject)
  })
}

/**
 * Adds SDK v3 method name aliases to the operations interface.
 * These aliases map the new SDK method names to their underlying OpenAPI operation names.
 * @param {string} filePath - The path to the TypeScript file to update
 */
function addSdkMethodAliases(filePath) {
  const content = readFileSync(filePath, 'utf8')

  // Find the closing brace of the operations interface
  const operationsInterfaceEnd = content.lastIndexOf('\n}')

  if (operationsInterfaceEnd === -1) {
    logger.error('    Could not find operations interface closing brace')
    return
  }

  const aliases = `  // SDK v3 method name aliases for TypeScript compatibility.
  // These map the new SDK method names to their underlying OpenAPI operation names.
  listOrganizations: operations['getOrganizations']
  listRepositories: operations['getOrgRepoList']
  createRepository: operations['createOrgRepo']
  deleteRepository: operations['deleteOrgRepo']
  updateRepository: operations['updateOrgRepo']
  getRepository: operations['getOrgRepo']
  listFullScans: operations['getOrgFullScanList']
  createFullScan: operations['CreateOrgFullScan']
  getFullScan: operations['getOrgFullScan']
  streamFullScan: operations['getOrgFullScan']
  deleteFullScan: operations['deleteOrgFullScan']
  getFullScanMetadata: operations['getOrgFullScanMetadata']
`

  const updated =
    content.slice(0, operationsInterfaceEnd) +
    aliases +
    content.slice(operationsInterfaceEnd)
  writeFileSync(filePath, updated, 'utf8')
  logger.log('    Added SDK v3 method name aliases')
}

/**
 * Fixes array syntax to comply with ESLint array-simple rules.
 * Simple types (string, number, boolean) use T[] syntax.
 * Complex types use Array<T> syntax.
 * @param {string} filePath - The path to the TypeScript file to fix
 */
function fixArraySyntax(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const magicString = new MagicString(content)

  // Parse the TypeScript file
  const ast = parser.parse(content, {
    sourceType: 'module',
    plugins: ['typescript'],
  })

  // Helper to determine if a type is simple
  const isSimpleType = node => {
    // Check for keyword types
    if (
      t.isTSStringKeyword(node) ||
      t.isTSNumberKeyword(node) ||
      t.isTSBooleanKeyword(node)
    ) {
      return true
    }

    // Check for type references to simple types
    if (t.isTSTypeReference(node)) {
      if (t.isIdentifier(node.typeName)) {
        const name = node.typeName.name
        return name === 'string' || name === 'number' || name === 'boolean'
      }
    }

    // Arrays of simple types are also considered simple for nested array purposes
    if (t.isTSArrayType(node)) {
      return isSimpleType(node.elementType)
    }

    return false
  }

  let transformCount = 0
  let skipCount = 0

  // Traverse the AST to find array types
  traverse.default(ast, {
    TSArrayType(path) {
      const node = path.node
      const elementType = node.elementType

      // Check if this is a simple type array
      if (isSimpleType(elementType)) {
        // For simple types (e.g., string[], number[])
        // we keep them as-is
        return
      }

      // For complex types, we need to change T[] to Array<T>
      const start = node.start
      const end = node.end

      if (start === null || end === null) {
        return
      }

      // Get the text of the element type
      const elementText = content.slice(elementType.start, elementType.end)

      try {
        // Use magic-string to replace T[] with Array<T>
        magicString.overwrite(start, end, `Array<${elementText}>`)
        transformCount++
      } catch {
        // Skip if already transformed (overlapping transformations)
        skipCount++
      }
    },
  })

  logger.log(
    `    Found ${transformCount + skipCount} complex arrays to transform`,
  )
  logger.log(
    `    Transformed ${transformCount}, skipped ${skipCount} (overlaps)`,
  )

  if (transformCount > 0) {
    const transformed = magicString.toString()

    // Verify transformations were actually applied
    const objectArrayCount = (transformed.match(/\}\[\]/g) || []).length
    const arrayGenericCount = (transformed.match(/Array</g) || []).length
    logger.log(
      `    Final check: ${objectArrayCount} object arrays with }[], ${arrayGenericCount} Array< generics`,
    )

    writeFileSync(filePath, transformed, 'utf8')
  }
}

async function main() {
  try {
    logger.log('Generating SDK from OpenAPI...')

    // Step 1: Prettify OpenAPI JSON
    logger.log('  1. Prettifying OpenAPI JSON...')
    let exitCode = await runCommand('node', ['scripts/prettify-base-json.mjs'])
    if (exitCode !== 0) {
      process.exitCode = exitCode
      return
    }

    // Step 2: Generate types
    logger.log('  2. Generating TypeScript types...')
    await generateTypes()

    // Step 3: Format generated files
    logger.log('  3. Formatting generated files...')
    exitCode = await runCommand('pnpm', [
      'exec',
      'biome',
      'format',
      '--log-level=none',
      '--fix',
      'openapi.json',
      'types/api.d.ts',
    ])
    if (exitCode !== 0) {
      process.exitCode = exitCode
      return
    }

    // Step 4: Run ESLint auto-fix to handle any remaining array syntax issues
    logger.log('  4. Running ESLint auto-fix on types/api.d.ts...')
    exitCode = await runCommand('pnpm', [
      'exec',
      'eslint',
      '--config',
      '.config/eslint.config.mjs',
      '--fix',
      'types/api.d.ts',
    ])
    // ESLint returns 0 if successful, 1 if there were fixable issues that were fixed
    // Only fail if exit code is 2 (unfixable errors)
    if (exitCode === 2) {
      logger.error('    ESLint found unfixable errors')
      process.exitCode = exitCode
      return
    }

    logger.log('SDK generation complete')
  } catch (error) {
    logger.error('SDK generation failed:', error.message)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
