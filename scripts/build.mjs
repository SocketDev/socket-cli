/**
 * @fileoverview Standardized build runner that adapts to project configuration.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
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
 * Run command quietly and capture output
 */
async function runCommandQuiet(command, args = [], options = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      stdio: 'pipe',
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    child.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('exit', (code) => {
      resolve({ code: code || 0, stdout, stderr })
    })

    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr, error: err })
    })
  })
}

/**
 * Create a simple progress spinner
 */
function createSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let frameIndex = 0
  let interval
  const startTime = Date.now()

  const start = () => {
    process.stdout.write(`${frames[0]} ${message}`)
    interval = setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length
      const elapsed = Date.now() - startTime
      const seconds = Math.floor(elapsed / 1000)
      const timeStr = seconds > 0 ? ` [${seconds}s]` : ''
      process.stdout.write(`\r\x1b[K${frames[frameIndex]} ${message}${timeStr}`)
    }, 100)
  }

  const stop = (success = true) => {
    if (interval) {
      clearInterval(interval)
      const elapsed = Date.now() - startTime
      const seconds = Math.floor(elapsed / 1000)
      const timeStr = seconds > 0 ? ` [${seconds}s]` : ''
      process.stdout.write('\r\x1b[K')

      if (success) {
        log.done(`${message.replace(/\.\.\.$/, '')} complete${timeStr}`)
      } else {
        log.failed(`${message.replace(/\.\.\.$/, '')} failed${timeStr}`)
      }
    }
  }

  return { start, stop }
}

/**
 * Prompt user for confirmation
 */
async function promptConfirmation(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    const answer = await rl.question(`${message} (y/N) `)
    return answer.toLowerCase() === 'y'
  } finally {
    rl.close()
  }
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
  const spinner = createSpinner('Building source code...')
  spinner.start()

  let result

  if (config.hasEsbuild) {
    // Use esbuild for socket-registry.
    const args = ['exec', 'node', 'scripts/esbuild.mjs', '--source']
    if (existsSync(path.join(rootPath, 'registry'))) {
      result = await runCommandQuiet('pnpm', args, {
        cwd: path.join(rootPath, 'registry')
      })
    } else {
      result = await runCommandQuiet('pnpm', args)
    }
  } else if (config.hasRollup) {
    // Use Rollup for socket-cli and others.
    const args = ['exec', 'rollup', '-c', config.rollupConfig, '--silent']
    result = await runCommandQuiet('pnpm', args)
  } else {
    // Fallback to TypeScript compiler.
    result = await runCommandQuiet('pnpm', ['exec', 'tsgo'])
  }

  if (result.code !== 0) {
    spinner.stop(false)

    // Show error details
    if (result.stderr) {
      log.error('Build errors:')
      // Show last 30 lines of stderr
      const lines = result.stderr.split('\n')
      const lastLines = lines.slice(-30).join('\n')
      console.error(lastLines)
    }

    // Re-run with full output for debugging
    log.info('\nRe-running with full output for debugging...')
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
    return result.code
  }

  spinner.stop(true)
  return 0
}

/**
 * Build TypeScript declarations.
 */
async function buildTypes(config) {
  if (!config.hasTypes) {
    return 0
  }

  const spinner = createSpinner('Building TypeScript declarations...')
  spinner.start()

  const args = ['exec', 'tsgo']
  if (config.tsConfig !== 'tsconfig.json') {
    args.push('--project', config.tsConfig)
  }

  const result = await runCommandQuiet('pnpm', args, {
    cwd: existsSync(path.join(rootPath, 'registry')) ? path.join(rootPath, 'registry') : rootPath
  })

  if (result.code !== 0) {
    spinner.stop(false)

    // Show error details
    if (result.stderr) {
      log.error('Type build errors:')
      // Show last 30 lines of stderr
      const lines = result.stderr.split('\n')
      const lastLines = lines.slice(-30).join('\n')
      console.error(lastLines)
    }

    // Re-run with full output for debugging
    log.info('\nRe-running with full output for debugging...')
    await runCommand('pnpm', args, {
      cwd: existsSync(path.join(rootPath, 'registry')) ? path.join(rootPath, 'registry') : rootPath
    })
    return result.code
  }

  spinner.stop(true)
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
      console.log('  --stub    Build standalone binary with yao-pkg')
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

      // Check if Node.js binary already exists
      const nodeBinary = WIN32 ? 'node.exe' : 'node'
      const centralNodePath = path.join(rootPath, 'binaries', 'socket-node', `node-v24.9.0-${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}${WIN32 ? '.exe' : ''}`)
      const buildNodePath = path.join(rootPath, 'build', 'socket-node', `node-v24.9.0-custom`, 'out', 'Release', nodeBinary)

      let existingNodePath = null
      if (existsSync(centralNodePath)) {
        existingNodePath = centralNodePath
      } else if (existsSync(buildNodePath)) {
        existingNodePath = buildNodePath
      }

      // Prompt for rebuild if binary exists
      if (existingNodePath) {
        const stats = statSync(existingNodePath)
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1)
        const relativeNodePath = path.relative(process.cwd(), existingNodePath)

        console.log(`\n${colors.yellow('⚠')}  Node.js binary already exists:`)
        console.log(`   Path: ${relativeNodePath}`)
        console.log(`   Size: ${sizeMB}MB`)
        console.log('')

        const shouldRebuild = await promptConfirmation('Do you want to rebuild?')

        if (!shouldRebuild) {
          console.log('\n✓ Build cancelled')
          process.exitCode = 0
          return
        }

        console.log('')
      }

      log.step('Building custom Node.js binary')

      const buildNodeScript = path.join(__dirname, 'build', 'build-socket-node.mjs')
      const nodeArgs = ['exec', 'node', buildNodeScript]

      const nodeExitCode = await runCommand('pnpm', nodeArgs)

      if (nodeExitCode !== 0) {
        log.error('Node build failed')
        process.exitCode = nodeExitCode
      } else {
        // Report file size
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

    // Handle standalone binary build.
    if (values.stub) {
      printHeader('Standalone Binary Builder (yao-pkg)')

      // Check if stub binary already exists
      const platformName = process.platform === 'darwin' ? 'macos' : process.platform
      const stubExt = WIN32 ? '.exe' : ''
      const stubPath = path.join(rootPath, 'binaries', 'stub', `socket-${platformName}-${process.arch}${stubExt}`)

      // Prompt for rebuild if binary exists
      if (existsSync(stubPath)) {
        const stats = statSync(stubPath)
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1)
        const relativeStubPath = path.relative(process.cwd(), stubPath)

        console.log(`\n${colors.yellow('⚠')}  Standalone binary already exists:`)
        console.log(`   Path: ${relativeStubPath}`)
        console.log(`   Size: ${sizeMB}MB`)
        console.log('')

        const shouldRebuild = await promptConfirmation('Do you want to rebuild?')

        if (!shouldRebuild) {
          console.log('\n✓ Build cancelled')
          process.exitCode = 0
          return
        }

        console.log('')
      }

      log.step('Building standalone executable')

      const buildStubScript = path.join(__dirname, 'build', 'build-stub.mjs')
      const stubArgs = ['exec', 'node', buildStubScript]

      const stubExitCode = await runCommand('pnpm', stubArgs)

      if (stubExitCode !== 0) {
        log.error('Stub build failed')
        process.exitCode = stubExitCode
      } else {
        const relativeStubPath = path.relative(process.cwd(), stubPath)
        printFooter('Standalone binary built successfully!')
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
      const cleanSpinner = createSpinner('Cleaning build directories...')
      cleanSpinner.start()

      const cleanResult = await runCommandQuiet('pnpm', ['run', 'clean', '--dist'])
      if (cleanResult.code !== 0) {
        cleanSpinner.stop(false)
        if (cleanResult.stderr) {
          log.error('Clean errors:')
          console.error(cleanResult.stderr)
        }
        process.exitCode = cleanResult.code
        return
      }
      cleanSpinner.stop(true)

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