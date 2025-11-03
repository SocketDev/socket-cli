#!/usr/bin/env node

/**
 * Script to fix vitest mock patterns in test files.
 * Converts vi.mock(() => ({ fn: vi.fn() })) to vi.hoisted(() => vi.fn()) pattern.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const testFiles = process.argv.slice(2)

if (!testFiles.length) {
  console.error('Usage: node fix-unit-test-mocks.mjs <test-file-1> [test-file-2] ...')
  process.exit(1)
}

async function fixTestFile(filePath) {
  console.log(`Processing: ${filePath}`)

  let content = await fs.readFile(filePath, 'utf-8')
  const originalContent = content

  // Track all mock functions we need to create
  const mocksToCreate = []

  // Find all vi.mock() calls and extract mock functions
  // Pattern: vi.mock('path', () => ({ fnName: vi.fn(...) }))
  const mockPattern = /vi\.mock\(['"](.*?)['"],\s*\(\)\s*=>\s*\(\{([\s\S]*?)\}\)\)/g

  let match
  while ((match = mockPattern.exec(content)) !== null) {
    const modulePath = match[1]
    const mockBody = match[2]

    // Extract function definitions from the mock body
    // Pattern: fnName: vi.fn(...)
    const fnPattern = /(\w+):\s*vi\.fn\((.*?)\)(?:,|\s*\})/g
    let fnMatch

    while ((fnMatch = fnPattern.exec(mockBody)) !== null) {
      const fnName = fnMatch[1]
      const fnArgs = fnMatch[2].trim()

      // Create mock name
      const mockName = `mock${fnName.charAt(0).toUpperCase()}${fnName.slice(1)}`

      // Store mock info
      mocksToCreate.push({
        mockName,
        fnName,
        fnArgs,
        modulePath,
      })
    }
  }

  if (!mocksToCreate.length) {
    console.log(`  No mocks to fix in ${filePath}`)
    return
  }

  // Group mocks by module path
  const mocksByModule = {}
  for (const mock of mocksToCreate) {
    if (!mocksByModule[mock.modulePath]) {
      mocksByModule[mock.modulePath] = []
    }
    mocksByModule[mock.modulePath].push(mock)
  }

  // Create hoisted mocks
  let hoistedMocks = ''
  const mockReplacements = {}

  for (const mock of mocksToCreate) {
    if (mock.fnArgs) {
      hoistedMocks += `const ${mock.mockName} = vi.hoisted(() => vi.fn(${mock.fnArgs}))\n`
    } else {
      hoistedMocks += `const ${mock.mockName} = vi.hoisted(() => vi.fn())\n`
    }
    mockReplacements[mock.fnName] = mock.mockName
  }

  // Find the first vi.mock() call and insert hoisted mocks before it
  const firstMockIndex = content.search(/vi\.mock\(/)
  if (firstMockIndex === -1) {
    console.log(`  No vi.mock() calls found in ${filePath}`)
    return
  }

  // Insert hoisted mocks before first vi.mock()
  const beforeFirstMock = content.slice(0, firstMockIndex)
  const afterFirstMock = content.slice(firstMockIndex)

  content = beforeFirstMock + hoistedMocks + '\n' + afterFirstMock

  // Replace vi.fn() calls in vi.mock() with hoisted mock references
  for (const [modulePath, mocks] of Object.entries(mocksByModule)) {
    for (const mock of mocks) {
      // Replace vi.fn(...) with mockFnName in the vi.mock() call
      const mockCallPattern = new RegExp(
        `(vi\\.mock\\(['"]${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"],\\s*\\(\\)\\s*=>\\s*\\(\\{[^}]*?${mock.fnName}:\\s*)vi\\.fn\\([^)]*\\)`,
        'g'
      )
      content = content.replace(mockCallPattern, `$1${mock.mockName}`)
    }
  }

  // Replace vi.mocked(fnName) with mockFnName
  for (const [fnName, mockName] of Object.entries(mockReplacements)) {
    const viMockedPattern = new RegExp(`vi\\.mocked\\(${fnName}\\)`, 'g')
    content = content.replace(viMockedPattern, mockName)

    // Also replace direct fnName.mockXxx() calls with mockFnName.mockXxx()
    // But be careful not to replace fnName in imports or other contexts
    // Only replace when it's followed by .mock
    const directMockPattern = new RegExp(`(?<!\\.)\\b${fnName}\\.(mock\\w+)`, 'g')
    content = content.replace(directMockPattern, `${mockName}.$1`)
  }

  if (content !== originalContent) {
    await fs.writeFile(filePath, content, 'utf-8')
    console.log(`  ✓ Fixed ${filePath}`)
  } else {
    console.log(`  No changes needed for ${filePath}`)
  }
}

// Process all files
for (const file of testFiles) {
  try {
    await fixTestFile(file)
  } catch (error) {
    console.error(`Error processing ${file}:`, error.message)
  }
}

console.log('Done!')
