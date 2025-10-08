#!/usr/bin/env node

/** @fileoverview Clean up old fetch and output files after migration to DRY utilities */

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const filesToRemove = [
  // Repository files
  'src/commands/repository/fetch-create-repo.mts',
  'src/commands/repository/fetch-delete-repo.mts',
  'src/commands/repository/fetch-list-repos.mts',
  'src/commands/repository/fetch-update-repo.mts',
  'src/commands/repository/fetch-view-repo.mts',
  'src/commands/repository/fetch-list-all-repos.mts',
  'src/commands/repository/output-create-repo.mts',
  'src/commands/repository/output-delete-repo.mts',
  'src/commands/repository/output-list-repos.mts',
  'src/commands/repository/output-update-repo.mts',
  'src/commands/repository/output-view-repo.mts',

  // Organization files
  'src/commands/organization/fetch-dependencies.mts',
  'src/commands/organization/fetch-license-policy.mts',
  'src/commands/organization/fetch-organization-list.mts',
  'src/commands/organization/fetch-quota.mts',
  'src/commands/organization/fetch-security-policy.mts',
  'src/commands/organization/output-dependencies.mts',
  'src/commands/organization/output-license-policy.mts',
  'src/commands/organization/output-organization-list.mts',
  'src/commands/organization/output-quota.mts',
  'src/commands/organization/output-security-policy.mts',

  // Also remove their test files
  'src/commands/repository/fetch-create-repo.test.mts',
  'src/commands/repository/fetch-delete-repo.test.mts',
  'src/commands/repository/fetch-list-repos.test.mts',
  'src/commands/repository/fetch-update-repo.test.mts',
  'src/commands/repository/fetch-view-repo.test.mts',
  'src/commands/repository/output-create-repo.test.mts',
  'src/commands/repository/output-delete-repo.test.mts',
  'src/commands/repository/output-list-repos.test.mts',
  'src/commands/repository/output-update-repo.test.mts',
  'src/commands/repository/output-view-repo.test.mts',
  'src/commands/organization/fetch-dependencies.test.mts',
  'src/commands/organization/fetch-license-policy.test.mts',
  'src/commands/organization/fetch-organization-list.test.mts',
  'src/commands/organization/fetch-quota.test.mts',
  'src/commands/organization/fetch-security-policy.test.mts',
  'src/commands/organization/output-dependencies.test.mts',
  'src/commands/organization/output-license-policy.test.mts',
  'src/commands/organization/output-organization-list.test.mts',
  'src/commands/organization/output-quota.test.mts',
  'src/commands/organization/output-security-policy.test.mts',

  // Old handle files that are replaced
  'src/commands/repository/handle-list-repos.mts',
  'src/commands/repository/handle-create-repo.mts',
  'src/commands/repository/handle-delete-repo.mts',
  'src/commands/repository/handle-update-repo.mts',
  'src/commands/repository/handle-view-repo.mts',
]

// Also remove the old simplified example since we have better ones now
filesToRemove.push('src/commands/repository/cmd-repository-list-simplified.mts')
filesToRemove.push('src/commands/repository/cmd-repository-list-simplified.test.mts')

let removedCount = 0
let notFoundCount = 0

console.log('🧹 Cleaning up old files after DRY migration...\n')

for (const file of filesToRemove) {
  if (existsSync(file)) {
    try {
      rmSync(file)
      console.log(`✅ Removed: ${file}`)
      removedCount++
    } catch (error) {
      console.error(`❌ Failed to remove: ${file}`)
      console.error(`   ${error.message}`)
    }
  } else {
    notFoundCount++
  }
}

console.log(`\n📊 Summary:`)
console.log(`   Removed: ${removedCount} files`)
console.log(`   Not found: ${notFoundCount} files`)

// Check for any remaining fetch/output files
console.log('\n🔍 Checking for remaining old files...')
try {
  const remaining = execSync(
    'find src/commands -name "fetch-*.mts" -o -name "output-*.mts" -o -name "handle-*.mts" | grep -v test',
    { encoding: 'utf8' }
  ).trim()

  if (remaining) {
    console.log('\n⚠️  Found additional old files that may need removal:')
    remaining.split('\n').forEach(file => console.log(`   ${file}`))
  } else {
    console.log('✅ No remaining old files found')
  }
} catch {
  console.log('✅ No remaining old files found')
}

console.log('\n✨ Cleanup complete!')