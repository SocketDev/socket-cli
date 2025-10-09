/**
 * @fileoverview Test wrapper for the project.
 * Handles test execution with Vitest, including:
 * - Glob pattern expansion for test file selection
 * - Memory optimization for RegExp-heavy tests
 * - Cross-platform compatibility (Windows/Unix)
 * - Build validation before running tests
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

import fastGlob from 'fast-glob'

import constants from './constants.mjs'

/**
 * Check if dist directory exists with required artifacts.
 */
function checkBuildArtifacts() {
  const distPath = path.join(constants.rootPath, 'dist')
  if (!existsSync(distPath)) {
    console.error('dist/ directory not found')
    console.error('Run `pnpm run build:dist:src` before running tests')
    return false
  }

  const requiredArtifacts = ['dist/cli.js']
  for (const artifact of requiredArtifacts) {
    const fullPath = path.join(constants.rootPath, artifact)
    if (!existsSync(fullPath)) {
      console.error(`Required build artifact missing: ${artifact}`)
      console.error('Run `pnpm run build:dist:src` before running tests')
      return false
    }
  }

  return true
}

/**
 * Main test execution flow.
 */
async function main() {
  const { WIN32 } = constants

  try {
    // Validate build artifacts exist.
    if (!checkBuildArtifacts()) {
      process.exitCode = 1
      return
    }

    // Parse command line arguments.
    let args = process.argv.slice(2)

    // Remove the -- separator if it's the first argument.
    if (args[0] === '--') {
      args = args.slice(1)
    }

    // Check for and warn about environment variables that can cause snapshot mismatches.
    // These are all aliases for the Socket API token that should not be set during tests.
    const problematicEnvVars = [
      'SOCKET_CLI_API_KEY',
      'SOCKET_CLI_API_TOKEN',
      'SOCKET_SECURITY_API_KEY',
      'SOCKET_SECURITY_API_TOKEN',
    ]
    const foundEnvVars = problematicEnvVars.filter(v => process.env[v])
    if (foundEnvVars.length > 0) {
      console.warn(
        `Detected environment variable(s) that may cause snapshot test failures: ${foundEnvVars.join(', ')}`,
      )
      console.warn(
        'These will be cleared for the test run to ensure consistent snapshots.',
      )
      console.warn(
        'Tests use .env.test configuration which should not include real API tokens.',
      )
    }

    const spawnEnv = {
      ...process.env,
      // Increase Node.js heap size to prevent out of memory errors.
      // Use 8GB in CI, 4GB locally.
      // Add --max-semi-space-size for better GC with RegExp-heavy tests.
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${process.env.CI ? 8192 : 4096} --max-semi-space-size=512`.trim(),
      // Clear problematic environment variables that cause snapshot mismatches.
      // Tests should use .env.test configuration instead.
      SOCKET_CLI_API_KEY: undefined,
      SOCKET_CLI_API_TOKEN: undefined,
      SOCKET_SECURITY_API_KEY: undefined,
      SOCKET_SECURITY_API_TOKEN: undefined,
    }

    // Handle Windows vs Unix for vitest executable.
    const vitestCmd = WIN32 ? 'vitest.cmd' : 'vitest'
    const vitestPath = path.join(constants.rootNodeModulesBinPath, vitestCmd)

    // Expand glob patterns in arguments.
    const expandedArgs = []
    for (const arg of args) {
      // Check if argument looks like a glob pattern.
      if (arg.includes('*') && !arg.startsWith('-')) {
        const files = fastGlob.sync(arg, { cwd: constants.rootPath })
        if (files.length === 0) {
          console.warn(`No files matched pattern: ${arg}`)
        }
        expandedArgs.push(...files)
      } else {
        expandedArgs.push(arg)
      }
    }

    // Pass remaining arguments to vitest.
    const vitestArgs = ['run', ...expandedArgs]

    // On Windows, .cmd files need shell: true.
    const spawnOptions = {
      cwd: constants.rootPath,
      env: spawnEnv,
      stdio: 'inherit',
      ...(WIN32 ? { shell: true } : {}),
    }

    const child = spawn(vitestPath, vitestArgs, spawnOptions)

    child.on('exit', code => {
      process.exitCode = code || 0
    })

    child.on('error', e => {
      console.error('Failed to spawn test process:', e)
      process.exitCode = 1
    })
  } catch (e) {
    console.error('Error running tests:', e)
    process.exitCode = 1
  }
}

main().catch(e => {
  console.error('Unexpected error:', e)
  process.exitCode = 1
})
