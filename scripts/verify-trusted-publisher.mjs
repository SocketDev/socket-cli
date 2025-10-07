#!/usr/bin/env node

/**
 * @fileoverview Verifies that trusted publisher is configured correctly for @socketbin packages.
 * Checks for provenance attestations and publisher information.
 */

import https from 'node:https'
import { spawn } from 'node:child_process'

const packages = [
  '@socketbin/cli-darwin-arm64',
  '@socketbin/cli-darwin-x64',
  '@socketbin/cli-linux-arm64',
  '@socketbin/cli-linux-x64',
  '@socketbin/cli-win32-arm64',
  '@socketbin/cli-win32-x64'
]

/**
 * Fetch package metadata from npm registry
 */
async function getPackageInfo(packageName) {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${packageName}`

    https.get(url, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

/**
 * Check npm attestations for a package
 */
async function checkAttestations(packageName, version = 'latest') {
  return new Promise((resolve) => {
    const child = spawn('npm', ['view', `${packageName}@${version}`, '--json'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', data => stdout += data)
    child.stderr.on('data', data => stderr += data)

    child.on('exit', () => {
      try {
        const data = JSON.parse(stdout)
        resolve({
          package: packageName,
          version: data.version || version,
          hasProvenance: !!data.dist?.attestations?.provenance,
          publishedBy: data.dist?.attestations?.provenance?.predicateType || null,
          npmUser: data._npmUser?.name || 'unknown'
        })
      } catch {
        resolve({
          package: packageName,
          version,
          hasProvenance: false,
          publishedBy: null,
          npmUser: 'unknown'
        })
      }
    })
  })
}

/**
 * Check GitHub workflow configuration
 */
async function checkWorkflow() {
  return new Promise((resolve) => {
    const child = spawn('gh', ['workflow', 'view', 'publish-socketbin.yml', '--json', 'name,state'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    child.stdout.on('data', data => stdout += data)

    child.on('exit', code => {
      if (code === 0) {
        try {
          const data = JSON.parse(stdout)
          resolve({
            exists: true,
            name: data.name,
            state: data.state
          })
        } catch {
          resolve({ exists: false })
        }
      } else {
        resolve({ exists: false })
      }
    })
  })
}

/**
 * Check if NPM_TOKEN is configured in GitHub secrets
 */
async function checkSecrets() {
  return new Promise((resolve) => {
    const child = spawn('gh', ['secret', 'list', '--json', 'name'], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    child.stdout.on('data', data => stdout += data)

    child.on('exit', code => {
      if (code === 0) {
        try {
          const secrets = JSON.parse(stdout)
          const hasNpmToken = secrets.some(s => s.name === 'NPM_TOKEN')
          resolve({ hasNpmToken })
        } catch {
          resolve({ hasNpmToken: false })
        }
      } else {
        resolve({ hasNpmToken: false })
      }
    })
  })
}

async function main() {
  console.log('🔍 Verifying Trusted Publisher Setup for @socketbin\n')
  console.log('=' .repeat(60))

  // Check if packages exist
  console.log('\n📦 Checking package status...\n')

  let allPublished = true
  const packageResults = []

  for (const pkg of packages) {
    try {
      const info = await getPackageInfo(pkg)
      const latest = info['dist-tags']?.latest
      if (latest) {
        console.log(`✅ ${pkg}@${latest}`)
        packageResults.push({ name: pkg, version: latest, exists: true })
      } else {
        console.log(`❌ ${pkg} - not published`)
        allPublished = false
        packageResults.push({ name: pkg, exists: false })
      }
    } catch {
      console.log(`❌ ${pkg} - not found`)
      allPublished = false
      packageResults.push({ name: pkg, exists: false })
    }
  }

  if (!allPublished) {
    console.log('\n⚠️  Not all packages are published yet.')
    console.log('Run: node scripts/publish-placeholders.mjs')
    console.log('\nTrusted publisher cannot be configured until packages exist.')
    process.exit(1)
  }

  // Check for provenance on existing packages
  console.log('\n🔐 Checking provenance attestations...\n')

  const attestationResults = await Promise.all(
    packageResults
      .filter(p => p.exists)
      .map(p => checkAttestations(p.name, p.version))
  )

  let hasProvenance = false
  for (const result of attestationResults) {
    if (result.hasProvenance) {
      console.log(`✅ ${result.package}@${result.version} - has provenance (published by ${result.npmUser})`)
      hasProvenance = true
    } else {
      console.log(`⚠️  ${result.package}@${result.version} - no provenance (manual publish by ${result.npmUser})`)
    }
  }

  // Check GitHub workflow
  console.log('\n🔧 Checking GitHub configuration...\n')

  const workflow = await checkWorkflow()
  if (workflow.exists) {
    console.log(`✅ Workflow exists: ${workflow.name}`)
    console.log(`   State: ${workflow.state}`)
  } else {
    console.log('❌ Workflow not found or gh CLI not configured')
    console.log('   Expected: .github/workflows/publish-socketbin.yml')
  }

  // Check secrets
  const secrets = await checkSecrets()
  if (secrets.hasNpmToken) {
    console.log('✅ NPM_TOKEN secret configured')
  } else {
    console.log('⚠️  NPM_TOKEN secret not found (or no access to check)')
  }

  // Summary
  console.log('\n' + '=' .repeat(60))
  console.log('\n📊 SUMMARY\n')

  if (!hasProvenance) {
    console.log('📝 Trusted Publisher Status: NOT CONFIGURED\n')
    console.log('This is expected for placeholder packages (v0.0.0).')
    console.log('\nTo enable trusted publisher:')
    console.log('1. Go to: https://www.npmjs.com/settings/socketbin/integrations')
    console.log('2. Click "Add Trusted Publisher"')
    console.log('3. Configure:')
    console.log('   - Repository: SocketDev/socket-cli')
    console.log('   - Workflow: .github/workflows/publish-socketbin.yml')
    console.log('   - Environment: (leave blank)\n')
    console.log('After configuration, the next publish from GitHub Actions will have provenance.')
  } else {
    console.log('✅ Trusted Publisher Status: CONFIGURED\n')
    console.log('Packages published from GitHub Actions will have provenance attestations.')
  }

  // Test command
  console.log('\n🧪 Test Commands:\n')
  console.log('Test the workflow (dry run):')
  console.log('  gh workflow run publish-socketbin.yml -f version=0.0.1-test -f dry-run=true\n')
  console.log('Publish with provenance (after trusted publisher is set):')
  console.log('  gh workflow run publish-socketbin.yml -f version=0.0.1\n')
  console.log('Check specific package provenance:')
  console.log('  npm view @socketbin/cli-darwin-arm64@latest dist.attestations.provenance')
}

// Run the script
main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})