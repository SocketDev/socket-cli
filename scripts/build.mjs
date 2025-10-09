/**
 * @fileoverview Standardized build runner that adapts to project configuration.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const WIN32 = process.platform === 'win32'

// Simple inline logger.
const log = {
  info: msg => console.log(msg),
  error: msg => console.error(`${colors.red('✗')} ${msg}`),
  success: msg => console.log(`${colors.green('✓')} ${msg}`),
  step: msg => console.log(`\n${msg}`),
  substep: msg => console.log(`  ${msg}`),
  progress: msg => process.stdout.write(`  ∴ ${msg}`),
  done: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.green('✓')} ${msg}`)
  },
  failed: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.red('✗')} ${msg}`)
  }
}

function printHeader(title) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log(`${'─'.repeat(60)}`)
}

function printFooter(message) {
  console.log(`\n${'─'.repeat(60)}`)
  if (message) {
    console.log(`  ${colors.green('✓')} ${message}`)
  }
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    child.on('exit', code => {
      resolve(code || 0)
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

/**
 * Detect build configuration for the project.
 */
function detectBuildConfig() {
  const config = {
    hasRollup: false,
    hasEsbuild: false,
    hasTypes: false,
    distPath: 'dist',
    typesPath: 'dist',
  }

  // Check for Rollup config.
  const rollupConfigs = [
    '.config/rollup.dist.config.mjs',
    '.config/rollup.config.mjs',
    'rollup.config.mjs',
    'rollup.config.js'
  ]
  for (const configFile of rollupConfigs) {
    if (existsSync(path.join(rootPath, configFile))) {
      config.hasRollup = true
      config.rollupConfig = configFile
      break
    }
  }

  // Check for esbuild script.
  if (existsSync(path.join(rootPath, 'scripts', 'esbuild.mjs'))) {
    config.hasEsbuild = true
  }

  // Check for TypeScript config for declarations.
  if (existsSync(path.join(rootPath, 'tsconfig.dts.json'))) {
    config.hasTypes = true
    config.tsConfig = 'tsconfig.dts.json'
  } else if (existsSync(path.join(rootPath, 'tsconfig.json'))) {
    config.hasTypes = true
    config.tsConfig = 'tsconfig.json'
  }

  // Check for registry-specific paths.
  if (existsSync(path.join(rootPath, 'registry'))) {
    config.distPath = path.join('registry', 'dist')
    config.typesPath = path.join('registry', 'dist')
  }

  return config
}

/**
 * Build source code.
 */
async function buildSource(config) {
  log.progress('Building source code')

  let exitCode = 0

  if (config.hasEsbuild) {
    // Use esbuild for socket-registry.
    const args = ['exec', 'node', 'scripts/esbuild.mjs', '--source']
    if (existsSync(path.join(rootPath, 'registry'))) {
      exitCode = await runCommand('pnpm', args, {
        cwd: path.join(rootPath, 'registry'),
        stdio: 'pipe'
      })
    } else {
      exitCode = await runCommand('pnpm', args, { stdio: 'pipe' })
    }
  } else if (config.hasRollup) {
    // Use Rollup for socket-cli and others.
    const args = ['exec', 'rollup', '-c', config.rollupConfig, '--silent']
    exitCode = await runCommand('pnpm', args, { stdio: 'pipe' })
  } else {
    // Fallback to TypeScript compiler.
    exitCode = await runCommand('pnpm', ['exec', 'tsgo'], { stdio: 'pipe' })
  }

  if (exitCode !== 0) {
    log.failed('Source build failed')
    // Re-run with output.
    if (config.hasEsbuild) {
      const args = ['exec', 'node', 'scripts/esbuild.mjs', '--source']
      if (existsSync(path.join(rootPath, 'registry'))) {
        await runCommand('pnpm', args, { cwd: path.join(rootPath, 'registry') })
      } else {
        await runCommand('pnpm', args)
      }
    } else if (config.hasRollup) {
      await runCommand('pnpm', ['exec', 'rollup', '-c', config.rollupConfig])
    } else {
      await runCommand('pnpm', ['exec', 'tsgo'])
    }
    return exitCode
  }

  log.done('Source build complete')
  return 0
}

/**
 * Build TypeScript declarations.
 */
async function buildTypes(config) {
  if (!config.hasTypes) {
    return 0
  }

  log.progress('Building TypeScript declarations')

  const args = ['exec', 'tsgo']
  if (config.tsConfig !== 'tsconfig.json') {
    args.push('--project', config.tsConfig)
  }

  const exitCode = await runCommand('pnpm', args, {
    cwd: existsSync(path.join(rootPath, 'registry')) ? path.join(rootPath, 'registry') : rootPath,
    stdio: 'pipe'
  })

  if (exitCode !== 0) {
    log.failed('Type declarations build failed')
    // Re-run with output.
    await runCommand('pnpm', args, {
      cwd: existsSync(path.join(rootPath, 'registry')) ? path.join(rootPath, 'registry') : rootPath
    })
    return exitCode
  }

  log.done('Type declarations built')
  return 0
}

/**
 * Check if build is needed.
 */
function isBuildNeeded(config) {
  const distIndexPath = path.join(rootPath, config.distPath, 'index.js')
  return !existsSync(distIndexPath)
}

async function main() {
  try {
    // Parse arguments.
    const { values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        src: {
          type: 'boolean',
          default: false,
        },
        types: {
          type: 'boolean',
          default: false,
        },
        watch: {
          type: 'boolean',
          default: false,
        },
        needed: {
          type: 'boolean',
          default: false,
        },
        node: {
          type: 'boolean',
          default: false,
        },
        stub: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('\nUsage: pnpm build [options]')
      console.log('\nOptions:')
      console.log('  --help    Show this help message')
      console.log('  --src     Build source code only')
      console.log('  --types   Build TypeScript declarations only')
      console.log('  --watch   Watch mode for development')
      console.log('  --needed  Only build if dist files are missing')
      console.log('  --node    Build custom Node.js binary (socket-node)')
      console.log('  --stub    Build stub/SEA binary (includes Node build if needed)')
      console.log('\nExamples:')
      console.log('  pnpm build         # Full build (source + types)')
      console.log('  pnpm build --src   # Build source only')
      console.log('  pnpm build --types # Build types only')
      console.log('  pnpm build --watch # Watch mode')
      console.log('  pnpm build --node  # Build custom Node.js binary')
      console.log('  pnpm build --stub  # Build standalone executable')
      process.exitCode = 0
      return
    }

    // Handle custom Node.js build.
    if (values.node) {
      printHeader('Custom Node.js Builder')
      log.step('Building custom Node.js binary')

      const buildNodeScript = path.join(__dirname, 'build', 'build-tiny-node.mjs')
      const nodeArgs = ['exec', 'node', buildNodeScript]

      const nodeExitCode = await runCommand('pnpm', nodeArgs)

      if (nodeExitCode !== 0) {
        log.error('Node build failed')
        process.exitCode = nodeExitCode
      } else {
        // Report file size
        const nodeBinary = WIN32 ? 'node.exe' : 'node'
        const centralNodePath = path.join(rootPath, 'binaries', 'socket-node', `node-v24.9.0-${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}${WIN32 ? '.exe' : ''}`)
        const buildNodePath = path.join(rootPath, 'build', 'socket-node', `node-v24.9.0-custom`, 'out', 'Release', nodeBinary)

        let nodePath = centralNodePath
        if (!existsSync(nodePath)) {
          nodePath = buildNodePath
        }

        if (existsSync(nodePath)) {
          const stats = statSync(nodePath)
          const sizeMB = (stats.size / 1024 / 1024).toFixed(1)
          const relativeNodePath = path.relative(process.cwd(), nodePath)
          printFooter(`Node.js built successfully! Size: ${sizeMB}MB`)
          console.log(`\n✨ To run locally:`)
          console.log(`   ./${relativeNodePath} [script.js]`)
          console.log(`   # Or use with Socket CLI:`)
          console.log(`   ./${relativeNodePath} bin/cli.js [command]`)
        } else {
          printFooter('Node.js built successfully!')
          console.log(`\n✨ To run locally:`)
          console.log(`   ./build/socket-node/node-v24.9.0-custom/out/Release/node [script.js]`)
        }
      }
      return
    }

    // Handle stub/SEA build.
    if (values.stub) {
      printHeader('Stub/SEA Builder')
      log.step('Building standalone executable')

      const buildStubScript = path.join(__dirname, 'build', 'build-stub.mjs')
      const stubArgs = ['exec', 'node', buildStubScript]

      const stubExitCode = await runCommand('pnpm', stubArgs)

      if (stubExitCode !== 0) {
        log.error('Stub build failed')
        process.exitCode = stubExitCode
      } else {
        // Determine the output path for the stub binary
        const platformName = process.platform === 'darwin' ? 'macos' : process.platform
        const stubExt = WIN32 ? '.exe' : ''
        const stubPath = path.join(rootPath, 'binaries', 'stub', `socket-${platformName}-${process.arch}${stubExt}`)

        const relativeStubPath = path.relative(process.cwd(), stubPath)
        printFooter('Stub/SEA binary built successfully!')
        console.log(`\n✨ To run locally:`)
        console.log(`   ./${relativeStubPath} [command]`)
        console.log(`   # Examples:`)
        console.log(`   ./${relativeStubPath} --help`)
        console.log(`   ./${relativeStubPath} scan .`)
      }
      return
    }

    // Detect build configuration.
    const config = detectBuildConfig()

    // Check if build is needed.
    if (values.needed && !isBuildNeeded(config)) {
      log.info('Build artifacts exist, skipping build')
      process.exitCode = 0
      return
    }

    printHeader('Build Runner')

    let exitCode = 0

    // Handle watch mode.
    if (values.watch) {
      log.step('Starting watch mode')
      log.substep('Watching for file changes...')

      if (config.hasRollup) {
        const args = ['exec', 'rollup', '-c', config.rollupConfig, '--watch', '--silent']
        exitCode = await runCommand('pnpm', args)
      } else if (config.hasEsbuild) {
        const args = ['exec', 'node', 'scripts/esbuild.mjs', '--watch']
        exitCode = await runCommand('pnpm', args, {
          cwd: existsSync(path.join(rootPath, 'registry')) ? rootPath : undefined
        })
      } else {
        log.error('Watch mode not configured for this project')
        exitCode = 1
      }
    }
    // Build types only.
    else if (values.types && !values.src) {
      log.step('Building TypeScript declarations only')
      exitCode = await buildTypes(config)
    }
    // Build source only.
    else if (values.src && !values.types) {
      log.step('Building source only')
      exitCode = await buildSource(config)
    }
    // Build everything (default).
    else {
      log.step('Building package')

      // Clean build directories first.
      log.progress('Cleaning build directories')
      const cleanCode = await runCommand('pnpm', ['run', 'clean', '--dist'], {
        stdio: 'pipe'
      })
      if (cleanCode !== 0) {
        log.failed('Clean failed')
        process.exitCode = cleanCode
        return
      }
      log.done('Build directories cleaned')

      // Build source and types.
      const sourceCode = await buildSource(config)
      if (sourceCode !== 0) {
        exitCode = sourceCode
      } else if (config.hasTypes) {
        exitCode = await buildTypes(config)
      }
    }

    if (exitCode !== 0) {
      log.error('Build failed')
      process.exitCode = exitCode
    } else {
      printFooter('Build completed successfully!')
      // Only show run instructions for non-watch, non-types-only builds
      if (!values.watch && !(values.types && !values.src)) {
        console.log(`\n✨ To run locally:`)
        console.log(`   pnpm exec socket [command]`)
        console.log(`   # Or directly:`)
        console.log(`   ./bin/cli.js [command]`)
        console.log(`   # Examples:`)
        console.log(`   pnpm exec socket --help`)
        console.log(`   ./bin/cli.js scan .`)
      }
    }
  } catch (error) {
    log.error(`Build runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)