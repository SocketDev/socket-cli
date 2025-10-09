/**
 * @fileoverview Standardized update runner that manages dependency updates.
 * Handles taze updates, Socket package updates, and project-specific tasks.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
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

function includesProvenanceDowngradeWarning(output) {
  const lowered = output.toString().toLowerCase()
  return (
    lowered.includes('provenance') &&
    (lowered.includes('downgrade') || lowered.includes('warn'))
  )
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

async function runCommandWithOutput(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let hasProvenanceDowngrade = false

    const child = spawn(command, args, {
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    if (child.stdout) {
      child.stdout.on('data', chunk => {
        stdout += chunk
        process.stdout.write(chunk)
        if (includesProvenanceDowngradeWarning(chunk)) {
          hasProvenanceDowngrade = true
        }
      })
    }

    if (child.stderr) {
      child.stderr.on('data', chunk => {
        stderr += chunk
        process.stderr.write(chunk)
        if (includesProvenanceDowngradeWarning(chunk)) {
          hasProvenanceDowngrade = true
        }
      })
    }

    child.on('exit', code => {
      resolve({ exitCode: code || 0, stdout, stderr, hasProvenanceDowngrade })
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

/**
 * Run taze to update dependencies.
 */
async function updateDependencies(options = {}) {
  const { check = false, write = false } = options

  log.progress('Checking for dependency updates')

  const args = ['exec', 'taze']

  // Add taze options.
  if (check) {
    args.push('--check')
  }
  if (write) {
    args.push('--write')
  }

  // Pass through any additional arguments.
  if (options.args && options.args.length > 0) {
    args.push(...options.args)
  }

  const result = await runCommandWithOutput('pnpm', args)

  if (result.hasProvenanceDowngrade) {
    log.failed('Provenance downgrade detected!')
    log.error('ERROR: Provenance downgrade detected! Failing to maintain security.')
    log.error('Configure your dependencies to maintain provenance or exclude problematic packages.')
    return 1
  }

  if (result.exitCode !== 0) {
    log.failed('Dependency update failed')
    return result.exitCode
  }

  log.done(write ? 'Dependencies updated' : 'Dependency check complete')
  return 0
}

/**
 * Update Socket packages to latest versions.
 */
async function updateSocketPackages() {
  log.progress('Updating Socket packages')

  const exitCode = await runCommand('pnpm', [
    '-r',
    'update',
    '@socketsecurity/*',
    '@socketregistry/*',
    '--latest'
  ])

  if (exitCode !== 0) {
    log.failed('Socket package update failed')
    return exitCode
  }

  log.done('Socket packages updated')
  return 0
}

/**
 * Run project-specific update scripts.
 */
async function runProjectUpdates() {
  const updates = []

  // Check for project-specific update scripts.
  const projectScripts = [
    'update-empty-dirs.mjs',
    'update-empty-files.mjs',
    'update-licenses.mjs',
    'update-manifest.mjs',
    'update-package-json.mjs',
    'update-npm-package-json.mjs',
    'update-npm-readmes.mjs',
    'update-data-npm.mjs'
  ]

  for (const script of projectScripts) {
    const scriptPath = path.join(rootPath, 'scripts', script)
    if (existsSync(scriptPath)) {
      updates.push({
        name: script.replace(/^update-/, '').replace(/\.mjs$/, ''),
        script: scriptPath
      })
    }
  }

  if (updates.length === 0) {
    return 0
  }

  log.step('Running project-specific updates')

  for (const { name, script } of updates) {
    log.progress(`Updating ${name}`)

    // eslint-disable-next-line no-await-in-loop
    const exitCode = await runCommand('node', [script], {
      stdio: 'pipe'
    })

    if (exitCode !== 0) {
      log.failed(`Failed to update ${name}`)
      return exitCode
    }

    log.done(`Updated ${name}`)
  }

  return 0
}

async function main() {
  try {
    // Parse arguments.
    const { positionals, values } = parseArgs({
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        check: {
          type: 'boolean',
          default: false,
        },
        write: {
          type: 'boolean',
          default: false,
        },
        deps: {
          type: 'boolean',
          default: false,
        },
        socket: {
          type: 'boolean',
          default: false,
        },
        project: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('\nUsage: pnpm update [options]')
      console.log('\nOptions:')
      console.log('  --help     Show this help message')
      console.log('  --check    Check for updates without modifying files')
      console.log('  --write    Write updates to package.json')
      console.log('  --deps     Update dependencies only')
      console.log('  --socket   Update Socket packages only')
      console.log('  --project  Run project-specific updates only')
      console.log('\nExamples:')
      console.log('  pnpm update                # Run all updates')
      console.log('  pnpm update --check        # Check for dependency updates')
      console.log('  pnpm update --write        # Update dependencies in package.json')
      console.log('  pnpm update --deps         # Update dependencies only')
      console.log('  pnpm update --socket       # Update Socket packages only')
      process.exitCode = 0
      return
    }

    printHeader('Update Runner')

    let exitCode = 0
    const runAll = !values.deps && !values.socket && !values.project

    // Update dependencies.
    if (runAll || values.deps) {
      log.step('Updating dependencies')
      exitCode = await updateDependencies({
        check: values.check,
        write: values.write,
        args: positionals
      })
      if (exitCode !== 0) {
        log.error('Dependency update failed')
        process.exitCode = exitCode
        return
      }
    }

    // Update Socket packages.
    if ((runAll || values.socket) && !values.check) {
      log.step('Updating Socket packages')
      exitCode = await updateSocketPackages()
      if (exitCode !== 0) {
        log.error('Socket package update failed')
        process.exitCode = exitCode
        return
      }
    }

    // Run project-specific updates.
    if ((runAll || values.project) && !values.check) {
      exitCode = await runProjectUpdates()
      if (exitCode !== 0) {
        log.error('Project updates failed')
        process.exitCode = exitCode
        return
      }
    }

    printFooter('All updates completed successfully!')
    process.exitCode = 0
  } catch (error) {
    log.error(`Update runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)