#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const testDir = 'test/unit/commands/organization'

const files = [
  'output-dependencies.test.mts',
  'output-license-policy.test.mts',
  'output-quota.test.mts',
  'output-security-policy.test.mts',
  'handle-dependencies.test.mts',
  'handle-license-policy.test.mts',
  'handle-organization-list.test.mts',
  'handle-quota.test.mts',
  'handle-security-policy.test.mts',
]

function fixImportPaths(content) {
  // Fix incorrect file extensions for mocked modules.
  // result-json.mjs should be result-json.mts.
  content = content.replace(
    /\/result-json\.mjs/g,
    '/result-json.mts',
  )

  // Fix malformed helper imports - should use the standard pattern.
  // From: '../../../../helpers/index.mts'
  // To: '../../../../../src/commands/../../../test/helpers/index.mts'
  content = content.replace(
    /'\.\.\/\.\.\/\.\.\/\.\.\/helpers\/([\w-]+\.mts)'/g,
    "'../../../../../src/commands/../../../test/helpers/$1'",
  )

  // Fix helpers import with malformed paths.
  content = content.replace(
    /'\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/commands\/\.\.\/\.\.\/\.\.\/test\/helpers\/([\w-]+\.mts)'/g,
    "'../../../../../src/commands/../../../test/helpers/$1'",
  )

  // Fix dynamic imports in await import() statements with malformed paths.
  // Pattern: await import('../../../../../src/commands/../src/FILENAME.mts')
  content = content.replace(
    /await import\('\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/commands\/\.\.\/src\/([a-z-]+\.mts)'\)/g,
    "await import('../../../../../src/commands/organization/$1')",
  )

  // Fix malformed import paths for output modules.
  content = content.replace(
    /'\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/commands\/\.\.\/src\/(output-[a-z-]+\.mts)'/g,
    "'../../../../../src/commands/organization/$1'",
  )

  // Fix malformed import paths for handle/fetch modules.
  content = content.replace(
    /'\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/commands\/(\.\.\/)+src\/commands\/organization\/([a-z-]+\.mts)'/g,
    "'../../../../../src/commands/organization/$2'",
  )

  // Fix relative import that should be absolute.
  content = content.replace(
    /'\.\/(output-security-policy\.mts)'/g,
    "'../../../../../src/commands/organization/$1'",
  )

  // Fix malformed type imports.
  content = content.replace(
    /'\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/commands\/(\.\.\/)+src\/commands\/organization\/types\.mts'/g,
    "'../../../../../src/types.mts'",
  )

  // Fix utils import paths.
  content = content.replace(
    /'\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/commands\/\.\.\/utils\//g,
    "'../../../../../src/utils/",
  )

  // Fix vi.mock paths for organization modules.
  content = content.replace(
    /vi\.mock\('\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/src\/commands\/(\.\.\/)+src\/commands\/organization\/([a-z-]+\.mts)'/g,
    "vi.mock('../../../../../src/commands/organization/$2'",
  )

  return content
}

for (const file of files) {
  const filePath = join(testDir, file)
  console.log(`Processing ${file}...`)

  const originalContent = readFileSync(filePath, 'utf-8')
  const fixedContent = fixImportPaths(originalContent)

  if (originalContent !== fixedContent) {
    writeFileSync(filePath, fixedContent, 'utf-8')
    console.log(`  ✓ Fixed ${file}`)
  } else {
    console.log(`  • No changes needed for ${file}`)
  }
}

console.log('\nAll files processed successfully!')
