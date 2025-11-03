#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const testDir = 'test/unit/commands/organization'

const files = [
  'handle-dependencies.test.mts',
  'handle-license-policy.test.mts',
  'handle-organization-list.test.mts',
  'handle-quota.test.mts',
  'handle-security-policy.test.mts',
]

function fixHandleTest(content) {
  // Add beforeEach import if not present.
  if (!content.includes('beforeEach')) {
    content = content.replace(
      /import \{ describe, expect, it, vi \} from 'vitest'/,
      "import { beforeEach, describe, expect, it, vi } from 'vitest'",
    )
  }

  // Add beforeEach hook after setupTestEnvironment if not present.
  if (!content.includes('beforeEach(() => {')) {
    content = content.replace(
      /describe\([^{]+\{[\s\S]*?setupTestEnvironment\(\)/,
      (match) => `${match}

  beforeEach(() => {
    vi.clearAllMocks()
  })`,
    )
  }

  // For each it() block, add dynamic imports at the start.
  // This pattern matches: it('test name', async () => {
  content = content.replace(
    /( +)it\(['"]([^'"]+)['"], async \(\) => \{/g,
    (match, indent, testName) => {
      // Check if this test already has imports inside it.
      return match
    },
  )

  // Add dynamic imports inside each test that uses vi.mocked.
  // Match pattern: vi.mocked(someFunction) where someFunction needs to be imported.
  const testBlockRegex = /( +)it\(['"]([^'"]+)['"], async \(\) => \{([\s\S]*?)(?=\n +it\(['"]|\n\}\)\n|$)/g

  content = content.replace(testBlockRegex, (match, indent, testName, testBody) => {
    // Check if test already has dynamic imports.
    if (testBody.includes('await import(')) {
      return match
    }

    // Find all vi.mocked() calls.
    const mockedCalls = [...testBody.matchAll(/vi\.mocked\((\w+)\)/g)]
    const functionsToImport = [
      ...new Set(mockedCalls.map(m => m[1])),
    ]

    if (functionsToImport.length === 0) {
      return match
    }

    // Generate import statements.
    const imports = functionsToImport
      .map(
        funcName =>
          `    const { ${funcName} } = await import('../../../../../src/commands/organization/${funcNameToFile(funcName)}.mts')`,
      )
      .join('\n')

    // Insert imports at the start of the test.
    return `${indent}it('${testName}', async () => {\n${imports}\n${testBody}`
  })

  return content
}

function funcNameToFile(funcName) {
  // Convert camelCase to kebab-case.
  return funcName
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

for (const file of files) {
  const filePath = join(testDir, file)
  console.log(`Processing ${file}...`)

  const originalContent = readFileSync(filePath, 'utf-8')
  const fixedContent = fixHandleTest(originalContent)

  if (originalContent !== fixedContent) {
    writeFileSync(filePath, fixedContent, 'utf-8')
    console.log(`  ✓ Fixed ${file}`)
  } else {
    console.log(`  • No changes needed for ${file}`)
  }
}

console.log('\nAll files processed successfully!')
