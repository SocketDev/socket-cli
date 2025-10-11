#!/usr/bin/env node
/**
 * Build script for creating a unified Socket CLI SEA binary that handles
 * multiple commands through symlinks.
 *
 * This creates a single binary that can be invoked as:
 * - socket (main CLI)
 * - socket-npm (npm wrapper)
 * - socket-npx (npx wrapper)
 * - socket-pnpm (pnpm wrapper)
 * - socket-yarn (yarn wrapper)
 *
 * The binary detects how it was invoked and routes accordingly.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createSymlinks } from './create-sea-symlinks.mjs'

const BUILD_DIR = path.join(process.cwd(), 'build', 'sea')
const BOOTSTRAP_PATH = path.join(
  process.cwd(),
  'src',
  'sea',
  'bootstrap-unified.mts',
)
const OUTPUT_DIR = path.join(process.cwd(), 'dist', 'sea')

/**
 * Compile TypeScript bootstrap to JavaScript.
 */
async function compileBootstrap() {
  console.log('Compiling unified bootstrap...')

  await fs.mkdir(BUILD_DIR, { recursive: true })

  const jsPath = path.join(BUILD_DIR, 'bootstrap-unified.js')

  // Use esbuild to compile and bundle
  const { build } = await import('esbuild')

  await build({
    entryPoints: [BOOTSTRAP_PATH],
    outfile: jsPath,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    bundle: true,
    minify: true,
    // Inline nanotar since it's the only dependency
    external: [],
  })

  console.log(`  Compiled to ${jsPath}`)
  return jsPath
}

/**
 * Create SEA configuration.
 */
async function createSeaConfig(jsPath) {
  const configPath = path.join(BUILD_DIR, 'sea-config.json')

  const config = {
    main: jsPath,
    output: path.join(BUILD_DIR, 'sea-blob.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true,
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))

  console.log('  Created SEA configuration')
  return configPath
}

/**
 * Generate SEA blob.
 */
async function generateSeaBlob(configPath) {
  console.log('Generating SEA blob...')

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-sea-config', configPath],
      { stdio: 'inherit' },
    )

    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        resolve(config.output)
      } else {
        reject(new Error(`SEA blob generation failed with code ${code}`))
      }
    })
  })
}

/**
 * Create executable from SEA blob.
 */
async function createExecutable(blobPath, platform = process.platform) {
  console.log(`Creating executable for ${platform}...`)

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const isWindows = platform === 'win32'
  const execName = isWindows ? 'socket.exe' : 'socket'
  const outputPath = path.join(OUTPUT_DIR, execName)

  // Copy node executable
  const nodeExe = process.execPath
  await fs.copyFile(nodeExe, outputPath)

  // Inject SEA blob using postject
  console.log('  Injecting SEA blob...')

  const postjectArgs = [
    outputPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ]

  if (platform === 'darwin') {
    // macOS requires code signing after modification
    postjectArgs.push('--macho-segment-name', 'NODE_SEA')
  }

  await new Promise((resolve, reject) => {
    const child = spawn('npx', ['postject', ...postjectArgs], {
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`postject failed with code ${code}`))
      }
    })
  })

  // Make executable on Unix
  if (!isWindows) {
    await fs.chmod(outputPath, 0o755)
  }

  // Sign on macOS
  if (platform === 'darwin') {
    console.log('  Code signing for macOS...')
    await new Promise((resolve, reject) => {
      const child = spawn('codesign', ['--sign', '-', outputPath], {
        stdio: 'inherit',
      })
      child.on('error', () => {
        console.warn('    Warning: codesign not available, skipping')
        resolve()
      })
      child.on('exit', resolve)
    })
  }

  console.log(`  Created ${outputPath}`)
  return outputPath
}

/**
 * Main build process.
 */
async function main() {
  try {
    console.log('Building unified Socket CLI SEA binary...\n')

    // Step 1: Compile bootstrap
    const jsPath = await compileBootstrap()

    // Step 2: Create SEA config
    const configPath = await createSeaConfig(jsPath)

    // Step 3: Generate SEA blob
    const blobPath = await generateSeaBlob(configPath)

    // Step 4: Create executable
    const execPath = await createExecutable(blobPath)

    // Step 5: Create symlinks for other commands
    console.log('\nCreating command symlinks...')
    await createSymlinks(execPath, OUTPUT_DIR)

    console.log('\n✅ Build complete!')
    console.log(`\nBinaries created in: ${OUTPUT_DIR}`)
    console.log('\nYou can now distribute these files:')

    const files = await fs.readdir(OUTPUT_DIR)
    for (const file of files) {
      const stat = await fs.stat(path.join(OUTPUT_DIR, file))
      const size = (stat.size / 1024 / 1024).toFixed(2)
      console.log(`  - ${file} (${size} MB)`)
    }

    console.log('\nTest the binary:')
    console.log(`  ${execPath} --version`)
    console.log(`  ${path.join(OUTPUT_DIR, 'socket-npm')} --version`)
    console.log(`  ${path.join(OUTPUT_DIR, 'socket-npx')} --version`)
  } catch (error) {
    console.error('\n❌ Build failed:', error.message)
    process.exit(1)
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
