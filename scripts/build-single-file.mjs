 
/**
 * Build Socket CLI as a single bundled JavaScript file.
 *
 * This creates one self-contained file that includes:
 * - All CLI code
 * - All dependencies (except Node.js built-ins)
 * - All utility modules
 *
 * Useful for:
 * - SEA/Yao packaging (which requires single entry point)
 * - Easier distribution (one file to copy)
 * - Embedding in other tools
 *
 * Usage:
 *   npm run build:single
 *   # Creates: dist-single/socket-cli-bundle.js
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { isVerbose } from '@socketsecurity/registry/lib/argv/flags'
import { printHeader } from '@socketsecurity/registry/lib/stdio/header'

async function buildSingleFile() {
  const _verbose = isVerbose()
  printHeader('Single File Builder')

  const rootDir = process.cwd()
  const distDir = path.join(rootDir, 'dist-single')

  // 1. Clean output directory
  console.log('1. Cleaning output directory...')
  await fs.rm(distDir, { recursive: true, force: true })
  await fs.mkdir(distDir, { recursive: true })

  // 2. Run rollup with single-file config
  console.log('2. Bundling with Rollup...')

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        'npx',
        ['rollup', '-c', '.config/rollup.single-file.config.mjs'],
        { stdio: 'inherit', shell: true },
      )

      child.on('error', reject)
      child.on('exit', code => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Rollup failed with exit code ${code}`))
        }
      })
    })
  } catch (error) {
    console.error('❌ Rollup build failed:', error.message)
    process.exit(1)
  }

  // 3. Make the output executable
  const outputFile = path.join(distDir, 'socket-cli-bundle.js')

  console.log('3. Making bundle executable...')
  await fs.chmod(outputFile, 0o755)

  // 4. Create convenience copies for other commands
  console.log('4. Creating command variants...')

  const commands = ['npm', 'npx', 'pnpm', 'yarn']
  for (const cmd of commands) {
    const bundlePath = path.join(distDir, `socket-${cmd}-bundle.js`)

    // Read original bundle
    const content = await fs.readFile(outputFile, 'utf8')

    // Modify to detect command variant
    const modifiedContent = content.replace(
      '#!/usr/bin/env node',
      `#!/usr/bin/env node
// Command variant: socket-${cmd}
process.env.SOCKET_CLI_VARIANT = 'socket-${cmd}';`,
    )

    await fs.writeFile(bundlePath, modifiedContent)
    await fs.chmod(bundlePath, 0o755)
  }

  // 5. Get file sizes
  console.log('\n5. Bundle statistics:')
  const files = await fs.readdir(distDir)

  let totalSize = 0
  for (const file of files) {
    const stat = await fs.stat(path.join(distDir, file))
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2)
    totalSize += stat.size
    console.log(`   - ${file}: ${sizeMB} MB`)
  }

  console.log(`   Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)

  // 6. Test the bundle
  console.log('\n6. Testing bundle...')

  try {
    await new Promise((resolve, reject) => {
      const child = spawn('node', [outputFile, '--version'], { stdio: 'pipe' })

      let output = ''
      child.stdout.on('data', data => {
        output += data
      })
      child.stderr.on('data', data => {
        output += data
      })

      child.on('exit', code => {
        if (code === 0) {
          console.log(`   ✅ Bundle works! Output: ${output.trim()}`)
          resolve()
        } else {
          reject(new Error(`Bundle test failed: ${output}`))
        }
      })
    })
  } catch (error) {
    console.warn('   ⚠️  Bundle test failed:', error.message)
  }

  console.log('\n✅ Single-file build complete!')
  console.log(`\nOutput location: ${distDir}`)
  console.log('\nUsage:')
  console.log(`  node ${outputFile} [args]`)
  console.log(`  # or`)
  console.log(`  ${outputFile} [args]  # (already executable)`)
  console.log('\nFor SEA packaging:')
  console.log(`  Use ${outputFile} as your single entry point`)
}

// Run the build
buildSingleFile().catch(error => {
  console.error('\n❌ Build failed:', error)
  process.exit(1)
})
