/**
 * @fileoverview Verifies that all @socketbin/* packages exist on npm registry.
 * Use after publishing to confirm everything is available.
 */

import https from 'node:https'

const packages = [
  '@socketbin/cli-darwin-arm64',
  '@socketbin/cli-darwin-x64',
  '@socketbin/cli-linux-arm64',
  '@socketbin/cli-linux-x64',
  '@socketbin/cli-win32-arm64',
  '@socketbin/cli-win32-x64',
]

async function checkPackage(name) {
  const url = `https://registry.npmjs.org/${name}`

  return new Promise(resolve => {
    https
      .get(url, res => {
        if (res.statusCode === 200) {
          let data = ''
          res.on('data', chunk => (data += chunk))
          res.on('end', () => {
            try {
              const pkg = JSON.parse(data)
              const latest = pkg['dist-tags']?.latest || 'unknown'
              resolve({ name, exists: true, version: latest })
            } catch {
              resolve({ name, exists: false })
            }
          })
        } else {
          resolve({ name, exists: false })
        }
      })
      .on('error', () => {
        resolve({ name, exists: false })
      })
  })
}

async function main() {
  console.log('🔍 Verifying @socketbin packages on npm...\n')

  const results = await Promise.all(packages.map(checkPackage))

  const existing = results.filter(r => r.exists)
  const missing = results.filter(r => !r.exists)

  if (existing.length > 0) {
    console.log('✅ Published packages:')
    for (const { name, version } of existing) {
      console.log(`   ${name}@${version}`)
    }
  }

  if (missing.length > 0) {
    console.log('\n❌ Missing packages:')
    for (const { name } of missing) {
      console.log(`   ${name}`)
    }
  }

  if (missing.length === 0) {
    console.log('\n🎉 All packages are published!')
    console.log('\nNext steps:')
    console.log(
      '1. Go to: https://www.npmjs.com/settings/socketbin/integrations',
    )
    console.log('2. Click "Add Trusted Publisher"')
    console.log('3. Enter:')
    console.log('   Repository: SocketDev/socket-cli')
    console.log('   Workflow: .github/workflows/publish-socketbin.yml')
    console.log('   Environment: (leave blank)')
    console.log('\nThen the workflow can publish with provenance!')
  } else {
    console.log('\n⚠️  Some packages are missing. Publish them first:')
    console.log('   node scripts/publish-placeholders.mjs')
  }
}

main()
