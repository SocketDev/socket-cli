/**
 * @fileoverview Optimized test runner with progress bar.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/registry/constants/platform'
import { isQuiet } from '@socketsecurity/registry/lib/argv/flags'
import { parseArgs } from '@socketsecurity/registry/lib/argv/parse'
import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'
import { onExit } from '@socketsecurity/registry/lib/signal-exit'
import { spinner } from '@socketsecurity/registry/lib/spinner'
import { printHeader } from '@socketsecurity/registry/lib/stdio/header'

// Suppress non-fatal worker termination unhandled rejections
process.on('unhandledRejection', (reason, _promise) => {
  const errorMessage = String(reason?.message || reason || '')
  // Filter out known non-fatal worker termination errors
  if (
    errorMessage.includes('Terminating worker thread') ||
    errorMessage.includes('ThreadTermination')
  ) {
    // Ignore these - they're cleanup messages from vitest worker threads
    return
  }
  // Re-throw other unhandled rejections
  throw reason
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.resolve(__dirname, '..')
const nodeModulesBinPath = path.join(rootPath, 'node_modules', '.bin')

// Track running processes for cleanup
const runningProcesses = new Set()

// Setup exit handler
const removeExitHandler = onExit((_code, signal) => {
  // Stop spinner first
  try {
    spinner.stop()
  } catch {}

  // Kill all running processes
  for (const child of runningProcesses) {
    try {
      child.kill('SIGTERM')
    } catch {}
  }

  if (signal) {
    console.log(`\nReceived ${signal}, cleaning up...`)
    process.exit(128 + (signal === 'SIGINT' ? 2 : 15))
  }
})

// Runs command with proper process tracking.
 
async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...(WIN32 && { shell: true }),
      ...options,
    })

    runningProcesses.add(child)

    child.on('exit', code => {
      runningProcesses.delete(child)
      resolve(code || 0)
    })

    child.on('error', error => {
      runningProcesses.delete(child)
      reject(error)
    })
  })
}

async function runCommandWithOutput(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      ...(WIN32 && { shell: true }),
      ...options,
    })

    runningProcesses.add(child)

    if (child.stdout) {
      child.stdout.on('data', data => {
        stdout += data.toString()
      })
    }

    if (child.stderr) {
      child.stderr.on('data', data => {
        stderr += data.toString()
      })
    }

    child.on('exit', code => {
      runningProcesses.delete(child)
      resolve({ code: code || 0, stdout, stderr })
    })

    child.on('error', error => {
      runningProcesses.delete(child)
      reject(error)
    })
  })
}

async function runCheck(options = {}) {
  const { quiet = false } = options

  if (!quiet) {
    logger.step('Running checks')
    console.log('  (Press Ctrl+O to show/hide output)')
    console.log()
  }

  // Import interactive runner for interactive experience
  const { runWithOutput } = await import('./utils/interactive-runner.mjs')

  // Run fix (auto-format)
  let exitCode = await runWithOutput('pnpm', ['run', 'fix'], {
    message: 'Formatting code',
    toggleText: 'to see formatter output',
    verbose: quiet,
  })
  if (exitCode !== 0) {
    if (!quiet) {
      logger.error('')
      logger.error('Formatting failed')
    }
    return exitCode
  }
  if (!quiet) {
    logger.success('Code formatted')
  }

  // Run ESLint
  exitCode = await runWithOutput('pnpm', ['run', 'lint'], {
    message: 'Running ESLint',
    toggleText: 'to see linter output',
    verbose: quiet,
  })
  if (exitCode !== 0) {
    if (!quiet) {
      logger.error('')
      logger.error('ESLint failed')
    }
    return exitCode
  }
  if (!quiet) {
    logger.success('ESLint passed')
  }

  // Run TypeScript check
  exitCode = await runWithOutput('pnpm', ['run', 'type'], {
    message: 'Checking TypeScript',
    toggleText: 'to see type errors',
    verbose: quiet,
  })
  if (exitCode !== 0) {
    if (!quiet) {
      logger.error('')
      logger.error('TypeScript check failed')
    }
    return exitCode
  }
  if (!quiet) {
    logger.success('TypeScript check passed')
  }

  return 0
}

async function runBuild() {
  const distIndexPath = path.join(rootPath, 'dist', 'index.mjs')
  if (!existsSync(distIndexPath)) {
    logger.step('Building project')

    // Import interactive runner for interactive experience
    const { runWithOutput } = await import('./utils/interactive-runner.mjs')

    const exitCode = await runWithOutput('pnpm', ['run', 'build'], {
      message: 'Building project',
      toggleText: 'to see build output',
    })
    if (exitCode !== 0) {
      logger.error('')
      logger.error('Build failed')
    }
    return exitCode
  }
  return 0
}

async function runVitestSimple(args, options = {}) {
  const { coverage = false, customNodePath, quiet = false, update = false } =
    options

  const vitestCmd = WIN32 ? 'vitest.cmd' : 'vitest'
  const vitestPath = path.join(nodeModulesBinPath, vitestCmd)

  const vitestArgs = ['run']

  // Add coverage if requested
  if (coverage) {
    vitestArgs.push('--coverage')
  }

  // Add update if requested
  if (update) {
    vitestArgs.push('--update')
  }

  // Add provided arguments
  if (args && args.length > 0) {
    vitestArgs.push(...args)
  }

  // Clean environment for tests
  const env = { ...process.env }
  delete env.DEBUG
  delete env.NODE_DEBUG
  delete env.NODE_COMPILE_CACHE

  // Suppress debug output unless specifically requested
  env.LOG_LEVEL = 'error'
  env.DEBUG_HIDE_DATE = '1'

  // Set optimized memory settings
  // Suppress unhandled rejections from worker thread cleanup
  env.NODE_OPTIONS = '--max-old-space-size=2048 --unhandled-rejections=warn'

  // If using custom Node binary, we need to run it directly instead of vitest wrapper.
  if (customNodePath) {
    // Run: customNodePath vitestPath run [args].
    const nodeArgs = [vitestPath, ...vitestArgs]

    // Use interactive runner for consistent Ctrl+O experience
    if (!quiet && process.stdout.isTTY) {
      const { runTests } = await import('./utils/interactive-runner.mjs')
      return runTests(customNodePath, nodeArgs, {
        env,
        cwd: rootPath,
        verbose: false,
      })
    }

    // Fallback to execution with output capture to handle worker termination errors
    const result = await runCommandWithOutput(customNodePath, nodeArgs, {
      cwd: rootPath,
      env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    // Print output if not quiet
    if (!quiet) {
      if (result.stdout) {
        process.stdout.write(result.stdout)
      }
      if (result.stderr) {
        process.stderr.write(result.stderr)
      }
    }

    // Check if we have worker termination error but no test failures
    const hasWorkerTerminationError =
      (result.stdout + result.stderr).includes('Terminating worker thread') ||
      (result.stdout + result.stderr).includes('ThreadTermination')

    const output = result.stdout + result.stderr
    const hasTestFailures =
      output.includes('FAIL') ||
      (output.includes('Test Files') && output.match(/(\d+) failed/) !== null) ||
      (output.includes('Tests') && output.match(/Tests\s+\d+ failed/) !== null)

    // Override exit code if we only have worker termination errors
    if (result.code !== 0 && hasWorkerTerminationError && !hasTestFailures) {
      return 0
    }

    return result.code
  }

  // Use interactive runner for consistent Ctrl+O experience
  if (!quiet && process.stdout.isTTY) {
    const { runTests } = await import('./utils/interactive-runner.mjs')
    return runTests(vitestPath, vitestArgs, {
      env,
      cwd: rootPath,
      verbose: false,
    })
  }

  // Fallback to execution with output capture to handle worker termination errors
  const result = await runCommandWithOutput(vitestPath, vitestArgs, {
    cwd: rootPath,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  // Print output if not quiet
  if (!quiet) {
    if (result.stdout) {
      process.stdout.write(result.stdout)
    }
    if (result.stderr) {
      process.stderr.write(result.stderr)
    }
  }

  // Check if we have worker termination error but no test failures
  const hasWorkerTerminationError =
    (result.stdout + result.stderr).includes('Terminating worker thread') ||
    (result.stdout + result.stderr).includes('ThreadTermination')

  const output = result.stdout + result.stderr
  const hasTestFailures =
    output.includes('FAIL') ||
    (output.includes('Test Files') && output.match(/(\d+) failed/) !== null) ||
    (output.includes('Tests') && output.match(/Tests\s+\d+ failed/) !== null)

  // Override exit code if we only have worker termination errors
  if (result.code !== 0 && hasWorkerTerminationError && !hasTestFailures) {
    return 0
  }

  return result.code
}

async function runTests(options) {
  const { coverage, customNodePath, positionals, quiet, update } = options

  // If positional arguments provided, use them directly
  if (positionals && positionals.length > 0) {
    if (!quiet) {
      logger.step(`Running specified tests: ${positionals.join(', ')}`)
    }
    return runVitestSimple(positionals, {
      coverage,
      customNodePath,
      quiet,
      update,
    })
  }

  // Run all tests by default
  if (!quiet) {
    logger.step('Running all tests')
  }
  return runVitestSimple([], { coverage, customNodePath, quiet, update })
}

async function main() {
  try {
    // Parse arguments
    const { positionals, values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        fast: {
          type: 'boolean',
          default: false,
        },
        quick: {
          type: 'boolean',
          default: false,
        },
        'skip-build': {
          type: 'boolean',
          default: false,
        },
        'skip-checks': {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        cover: {
          type: 'boolean',
          default: false,
        },
        coverage: {
          type: 'boolean',
          default: false,
        },
        update: {
          type: 'boolean',
          default: false,
        },
        quiet: {
          type: 'boolean',
          default: false,
        },
        silent: {
          type: 'boolean',
          default: false,
        },
        yao: {
          type: 'boolean',
          default: false,
        },
        sea: {
          type: 'boolean',
          default: false,
        },
        bun: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      console.log('Test Runner')
      console.log('\nUsage: pnpm test [options] [test-files...]')
      console.log('\nOptions:')
      console.log('  --help              Show this help message')
      console.log(
        '  --fast, --quick     Skip lint/type checks for faster execution',
      )
      console.log(
        '  --skip-checks       Skip lint/type checks (same as --fast)',
      )
      console.log('  --skip-build        Skip the build step')
      console.log('  --cover, --coverage Run tests with code coverage')
      console.log('  --update            Update test snapshots')
      console.log('  --all               Run all tests')
      console.log('  --quiet, --silent   Minimal output')
      console.log('  --yao               Test with yao-pkg binary from build/out/Yao/node')
      console.log('  --sea               Test with SEA binary from build/out/Sea/node')
      console.log('  --bun               Test with Bun runtime (if installed)')
      console.log('\nExamples:')
      console.log(
        '  pnpm test                      # Run checks, build, and tests',
      )
      console.log(
        '  pnpm test --fast               # Skip checks for quick testing',
      )
      console.log('  pnpm test --cover              # Run with coverage report')
      console.log(
        '  pnpm test "**/*.test.mts"      # Run specific test pattern',
      )
      console.log(
        '  pnpm test --yao                # Test with yao-pkg custom binary',
      )
      console.log(
        '  pnpm test --sea                # Test with SEA custom binary',
      )
      console.log(
        '  pnpm test --bun                # Test with Bun runtime',
      )
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      printHeader('Test Runner')
    }

    // Handle custom runtime selection with validation.
    let customNodePath = null

    // Validate that multiple runtime flags are not set.
    const runtimeFlags = [values.yao, values.sea, values.bun].filter(Boolean)
    if (runtimeFlags.length > 1) {
      if (!quiet) {
        logger.error('')
        logger.error(
          'Cannot use multiple runtime flags (--yao, --sea, --bun) simultaneously. Please choose one.',
        )
      }
      process.exitCode = 1
      return
    }

    if (values.bun) {
      // Handle Bun runtime selection.
      if (!quiet) {
        logger.step('Checking for Bun runtime')
        logger.logNewline()
      }

      // Check if Bun is installed.
      try {
        let bunResult = await runCommandWithOutput('which', ['bun'], {
          cwd: rootPath,
          timeout: 5000,
        })

        if (bunResult.code !== 0 || !bunResult.stdout.trim()) {
          if (!quiet) {
            logger.error('')
            logger.error('Bun is not installed on this system.')
            logger.logNewline()
          }

          // Prompt to install Bun.
          let shouldInstall = false
          try {
            shouldInstall = await confirm({
              message: 'Would you like to install Bun now?',
              default: true,
            })
          } catch (e) {
            // User cancelled prompt (Ctrl+C).
            if (!quiet) {
              logger.error('')
              logger.error('Installation cancelled.')
            }
            process.exitCode = 1
            return
          }

          if (!shouldInstall) {
            if (!quiet) {
              logger.error('')
              logger.error('Cannot proceed without Bun runtime.')
              logger.logNewline()
              logger.log('To install Bun later, run:')
              logger.log('  node scripts/install-bun.mjs')
              logger.logNewline()
              logger.log('Or visit: https://bun.sh for more installation options')
              logger.logNewline()
            }
            process.exitCode = 1
            return
          }

          // Run install-bun.mjs script.
          const installScript = path.join(rootPath, 'scripts', 'install-bun.mjs')
          if (!quiet) {
            logger.log(`Running: node ${installScript}`)
            logger.logNewline()
          }

          const installExitCode = await runCommand('node', [installScript], {
            cwd: rootPath,
            stdio: 'inherit',
          })

          if (installExitCode !== 0) {
            if (!quiet) {
              logger.error('')
              logger.error('Failed to install Bun')
            }
            process.exitCode = installExitCode
            return
          }

          // Verify Bun was installed by checking again.
          bunResult = await runCommandWithOutput('which', ['bun'], {
            cwd: rootPath,
            timeout: 5000,
          })

          if (bunResult.code !== 0 || !bunResult.stdout.trim()) {
            if (!quiet) {
              logger.error('')
              logger.error('Bun installation succeeded but Bun is still not found.')
              logger.logNewline()
              logger.log('You may need to restart your terminal or source your shell configuration:')
              logger.log('  source ~/.bashrc  # or ~/.zshrc')
              logger.logNewline()
            }
            process.exitCode = 1
            return
          }

          if (!quiet) {
            logger.success('✅ Bun installed successfully')
            logger.logNewline()
          }
        }

        const bunPath = bunResult.stdout.trim()

        // Test Bun execution.
        const bunVersionResult = await runCommandWithOutput(bunPath, ['--version'], {
          cwd: rootPath,
          timeout: 5000,
        })

        if (bunVersionResult.code !== 0) {
          if (!quiet) {
            logger.error('')
            logger.error('Bun execution test failed.')
            if (bunVersionResult.stderr) {
              logger.error(`Error output: ${bunVersionResult.stderr}`)
            }
          }
          process.exitCode = bunVersionResult.code
          return
        }

        const bunVersion = bunVersionResult.stdout.trim()
        customNodePath = bunPath

        if (!quiet) {
          logger.success(`✅ Using Bun ${bunVersion} for tests`)
          logger.logNewline()
        }
      } catch (e) {
        if (!quiet) {
          logger.error('')
          logger.error(
            `Failed to check for Bun: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
        process.exitCode = 1
        return
      }
    } else if (values.yao || values.sea) {
      // Handle custom Node binary selection.
      const buildType = values.yao ? 'Yao' : 'Sea'
      const buildDir = path.join(rootPath, 'build', 'out', buildType)
      const binaryName = WIN32 ? 'node.exe' : 'node'
      const binaryPath = path.join(buildDir, binaryName)

      // For yao binaries, use wrapper if available.
      let testBinaryPath = binaryPath
      if (values.yao) {
        const wrapperPath = path.join(buildDir, 'yao-wrapper.js')
        if (existsSync(wrapperPath)) {
          testBinaryPath = wrapperPath
        }
      }

      if (!quiet) {
        logger.step(`Validating ${buildType} binary`)
        logger.log(`Looking for binary at: ${binaryPath}`)
        if (values.yao && testBinaryPath !== binaryPath) {
          logger.log(`Using wrapper at: ${testBinaryPath}`)
        }
        logger.logNewline()
      }

      // Check if binary exists.
      if (!existsSync(binaryPath)) {
        if (!quiet) {
          logger.error('')
          logger.error(
            `${buildType} binary not found at: ${binaryPath}`,
          )
          logger.logNewline()
        }

        // Prompt to build the missing binary.
        let shouldBuild = false
        try {
          shouldBuild = await confirm({
            message: `${buildType} binary is not built. Would you like to build it now?`,
            default: true,
          })
        } catch (e) {
          // User cancelled prompt (Ctrl+C).
          if (!quiet) {
            logger.error('')
            logger.error('Build cancelled.')
          }
          process.exitCode = 1
          return
        }

        if (!shouldBuild) {
          if (!quiet) {
            logger.error('')
            logger.error(`Cannot proceed without ${buildType} binary.`)
          }
          process.exitCode = 1
          return
        }

        // Build the missing binary.
        if (values.yao) {
          // Build yao-pkg binary.
          const buildYaoScript = path.join(rootPath, 'scripts', 'build-yao-pkg-node.mjs')
          if (!quiet) {
            logger.log(`Running: node ${buildYaoScript}`)
            logger.logNewline()
          }

          const buildExitCode = await runCommand('node', [buildYaoScript], {
            cwd: rootPath,
            stdio: 'inherit',
          })

          if (buildExitCode !== 0) {
            if (!quiet) {
              logger.error('')
              logger.error('Failed to build yao-pkg binary')
            }
            process.exitCode = buildExitCode
            return
          }

          // Verify binary was created.
          if (!existsSync(binaryPath)) {
            if (!quiet) {
              logger.error('')
              logger.error(
                `Build succeeded but binary still not found at: ${binaryPath}`,
              )
            }
            process.exitCode = 1
            return
          }

          if (!quiet) {
            logger.success('✅ Yao-pkg binary built successfully')
            logger.logNewline()
          }
        } else {
          // Build SEA binary.
          const buildSeaScript = path.join(rootPath, 'scripts', 'build-sea.mjs')
          if (!quiet) {
            logger.log(`Running: node ${buildSeaScript}`)
            logger.logNewline()
          }

          const buildExitCode = await runCommand('node', [buildSeaScript], {
            cwd: rootPath,
            stdio: 'inherit',
          })

          if (buildExitCode !== 0) {
            if (!quiet) {
              logger.error('')
              logger.error('Failed to build SEA binary')
            }
            process.exitCode = buildExitCode
            return
          }

          // Verify binary was created.
          if (!existsSync(binaryPath)) {
            if (!quiet) {
              logger.error('')
              logger.error(
                `Build succeeded but binary still not found at: ${binaryPath}`,
              )
            }
            process.exitCode = 1
            return
          }

          if (!quiet) {
            logger.success('✅ SEA binary built successfully')
            logger.logNewline()
          }
        }
      }

      // Verify binary is executable.
      try {
        const stats = await import('node:fs/promises').then(fs =>
          fs.stat(binaryPath),
        )
        // Check if file has execute permission (Unix-like systems).
        if (process.platform !== 'win32') {
          const isExecutable = (stats.mode & 0o111) !== 0
          if (!isExecutable) {
            if (!quiet) {
              logger.error('')
              logger.error(`Binary is not executable: ${binaryPath}`)
              logger.logNewline()
              logger.log('Making binary executable...')
              logger.logNewline()
            }

            // Make binary executable.
            const chmodExitCode = await runCommand('chmod', ['+x', binaryPath], {
              cwd: rootPath,
            })

            if (chmodExitCode !== 0) {
              if (!quiet) {
                logger.error('')
                logger.error('Failed to make binary executable')
              }
              process.exitCode = chmodExitCode
              return
            }

            if (!quiet) {
              logger.success('✅ Binary is now executable')
              logger.logNewline()
            }
          }
        }
      } catch (e) {
        if (!quiet) {
          logger.error('')
          logger.error(
            `Failed to check binary permissions: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
        process.exitCode = 1
        return
      }

      // Test binary execution.
      if (!quiet) {
        logger.log('Testing binary execution...')
        logger.logNewline()
      }

      try {
        const testResult = await runCommandWithOutput(testBinaryPath, ['--version'], {
          cwd: rootPath,
          timeout: 5000,
        })

        if (testResult.code !== 0) {
          if (!quiet) {
            logger.error('')
            logger.error(`Binary execution test failed with exit code: ${testResult.code}`)
            if (testResult.stderr) {
              logger.error(`Error output: ${testResult.stderr}`)
            }
          }
          process.exitCode = testResult.code
          return
        }

        const version = testResult.stdout.trim()
        if (!quiet) {
          logger.success(`✅ Binary is working (Node.js ${version})`)
          logger.logNewline()
        }
      } catch (e) {
        if (!quiet) {
          logger.error('')
          logger.error(
            `Binary execution test failed: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
        process.exitCode = 1
        return
      }

      // All checks passed - use this binary.
      customNodePath = testBinaryPath

      if (!quiet) {
        logger.success(`✅ Using ${buildType} binary for tests`)
        logger.logNewline()
      }
    }

    // Handle aliases
    const skipChecks = values.fast || values.quick || values['skip-checks']
    const withCoverage = values.cover || values.coverage

    let exitCode = 0

    // Run checks unless skipped
    if (!skipChecks) {
      exitCode = await runCheck({ quiet })
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('')
          console.log('Checks failed')
        }
        process.exitCode = exitCode
        return
      }
      if (!quiet) {
        logger.success('All checks passed')
        console.log()
      }
    }

    // Run build unless skipped
    if (!values['skip-build']) {
      exitCode = await runBuild()
      if (exitCode !== 0) {
        if (!quiet) {
          logger.error('')
          console.log('Build failed')
        }
        process.exitCode = exitCode
        return
      }
    }

    // Run tests
    exitCode = await runTests({
      ...values,
      coverage: withCoverage,
      customNodePath,
      positionals,
      quiet,
    })

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('')
        console.log('Tests failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        console.log()
        logger.success('All tests passed!')
      }
    }
  } catch (error) {
    // Ensure spinner is stopped
    try {
      spinner.stop()
    } catch {}
    logger.error('')
    console.log(`Test runner failed: ${error.message}`)
    process.exitCode = 1
  } finally {
    // Ensure spinner is stopped and cleared
    try {
      spinner.stop()
    } catch {}
    try {
      // Clear any remaining spinner output - multiple times to be sure
      process.stdout.write('\r\x1b[K')
      process.stdout.write('\r')
    } catch {}
    removeExitHandler()
    // Explicitly exit to prevent hanging
    process.exit(process.exitCode || 0)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
