/**
 * @fileoverview Synchronize CLAUDE.md files across Socket projects.
 * Uses Claude to intelligently update documentation, making socket-registry/CLAUDE.md
 * the canonical source for cross-project standards while preserving project-specific content.
 */

import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const parentPath = path.join(rootPath, '..')
const WIN32 = process.platform === 'win32'

// Socket project names to sync.
const SOCKET_PROJECTS = [
  'socket-cli',
  'socket-sdk-js',
  'socket-packageurl-js',
  'socket-registry'
]

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
  },
  warn: msg => console.log(`${colors.yellow('⚠')} ${msg}`)
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

async function runCommandWithOutput(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...options,
    })

    if (child.stdout) {
      child.stdout.on('data', data => {
        stdout += data
      })
    }

    if (child.stderr) {
      child.stderr.on('data', data => {
        stderr += data
      })
    }

    child.on('exit', code => {
      resolve({ exitCode: code || 0, stdout, stderr })
    })

    child.on('error', error => {
      reject(error)
    })
  })
}

/**
 * Check if claude-console is available.
 */
async function checkClaude() {
  const checkCommand = WIN32 ? 'where' : 'which'
  const result = await runCommandWithOutput(checkCommand, ['claude-console'])

  if (result.exitCode !== 0) {
    // Also check common aliases.
    const aliasResult = await runCommandWithOutput(checkCommand, ['claude'])
    if (aliasResult.exitCode !== 0) {
      return false
    }
    return 'claude'
  }
  return 'claude-console'
}

/**
 * Find Socket projects in parent directory.
 */
async function findSocketProjects() {
  const projects = []

  for (const projectName of SOCKET_PROJECTS) {
    const projectPath = path.join(parentPath, projectName)
    const claudeMdPath = path.join(projectPath, 'CLAUDE.md')

    if (existsSync(projectPath) && existsSync(claudeMdPath)) {
      projects.push({
        name: projectName,
        path: projectPath,
        claudeMdPath
      })
    }
  }

  return projects
}

/**
 * Create a Claude prompt for updating CLAUDE.md files.
 */
function createSyncPrompt(projectName, isRegistry = false) {
  if (isRegistry) {
    return `You are updating the CLAUDE.md file in the socket-registry project, which is the CANONICAL source for all cross-project Socket standards.

Your task:
1. Review the current CLAUDE.md in socket-registry
2. Identify any sections that should be the authoritative source for ALL Socket projects
3. Ensure these sections are clearly marked as "SHARED STANDARDS" or similar
4. Keep the content well-organized and comprehensive

The socket-registry/CLAUDE.md should contain:
- Cross-platform compatibility rules
- Node.js version requirements
- Safe file operations standards
- Git workflow standards
- Testing & coverage standards
- Package management standards
- Code style guidelines
- Error handling patterns
- Any other standards that apply to ALL Socket projects

Output ONLY the updated CLAUDE.md content, nothing else.`
  }

  return `You are updating the CLAUDE.md file in the ${projectName} project.

The socket-registry/CLAUDE.md is the CANONICAL source for all cross-project standards. Your task:

1. Read the canonical ../socket-registry/CLAUDE.md
2. Read the current CLAUDE.md in ${projectName}
3. Update ${projectName}/CLAUDE.md to:
   - Reference the canonical socket-registry/CLAUDE.md for all shared standards
   - Remove any redundant cross-project information that's already in socket-registry
   - Keep ONLY project-specific guidelines and requirements
   - Add a clear reference at the top pointing to socket-registry/CLAUDE.md as the canonical source

The ${projectName}/CLAUDE.md should contain:
- A reference to socket-registry/CLAUDE.md as the canonical source
- Project-specific architecture notes
- Project-specific commands and workflows
- Project-specific dependencies or requirements
- Any unique patterns or rules for this project only

Start the file with something like:
# CLAUDE.md

**CANONICAL REFERENCE**: See ../socket-registry/CLAUDE.md for shared Socket standards.

Then include only PROJECT-SPECIFIC content.

Output ONLY the updated CLAUDE.md content, nothing else.`
}

/**
 * Update a project's CLAUDE.md using Claude.
 */
async function updateProjectClaudeMd(claudeCmd, project) {
  const { name, claudeMdPath } = project
  const isRegistry = name === 'socket-registry'

  log.progress(`Updating ${name}/CLAUDE.md`)

  // Read current content.
  const currentContent = await fs.readFile(claudeMdPath, 'utf8')

  // Read canonical content if not registry.
  let canonicalContent = ''
  if (!isRegistry) {
    const canonicalPath = path.join(parentPath, 'socket-registry', 'CLAUDE.md')
    if (existsSync(canonicalPath)) {
      canonicalContent = await fs.readFile(canonicalPath, 'utf8')
    }
  }

  // Create the prompt.
  const prompt = createSyncPrompt(name, isRegistry)

  // Build full context for Claude.
  let fullPrompt = prompt + '\n\n'

  if (!isRegistry && canonicalContent) {
    fullPrompt += `===== CANONICAL socket-registry/CLAUDE.md =====
${canonicalContent}

`
  }

  fullPrompt += `===== CURRENT ${name}/CLAUDE.md =====
${currentContent}

===== OUTPUT UPDATED ${name}/CLAUDE.md BELOW =====`

  // Call Claude to update the file.
  const result = await runCommandWithOutput(claudeCmd, [], {
    input: fullPrompt,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  if (result.exitCode !== 0) {
    log.failed(`Failed to update ${name}/CLAUDE.md`)
    return false
  }

  // Extract the updated content.
  const updatedContent = result.stdout.trim()

  // Write the updated file.
  await fs.writeFile(claudeMdPath, updatedContent)
  log.done(`Updated ${name}/CLAUDE.md`)

  return true
}

/**
 * Commit changes in a project.
 */
async function commitChanges(project) {
  const { name, path: projectPath } = project

  log.progress(`Committing changes in ${name}`)

  // Check if there are changes to commit.
  const statusResult = await runCommandWithOutput('git', ['status', '--porcelain', 'CLAUDE.md'], {
    cwd: projectPath
  })

  if (!statusResult.stdout.trim()) {
    log.done(`No changes in ${name}`)
    return true
  }

  // Stage the file.
  await runCommand('git', ['add', 'CLAUDE.md'], {
    cwd: projectPath,
    stdio: 'pipe'
  })

  // Commit with appropriate message.
  const message = name === 'socket-registry'
    ? 'Update CLAUDE.md as canonical source for cross-project standards'
    : 'Sync CLAUDE.md with canonical socket-registry standards'

  const commitResult = await runCommandWithOutput('git', ['commit', '-m', message, '--no-verify'], {
    cwd: projectPath
  })

  if (commitResult.exitCode !== 0) {
    log.failed(`Failed to commit in ${name}`)
    return false
  }

  log.done(`Committed changes in ${name}`)
  return true
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
        'dry-run': {
          type: 'boolean',
          default: false,
        },
        'skip-commit': {
          type: 'boolean',
          default: false,
        },
        push: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: false,
      strict: false,
    })

    // Show help if requested.
    if (values.help) {
      console.log('\nUsage: pnpm sync-claude [options]')
      console.log('\nSynchronize CLAUDE.md files across Socket projects.')
      console.log('\nOptions:')
      console.log('  --help         Show this help message')
      console.log('  --dry-run      Preview changes without writing files')
      console.log('  --skip-commit  Update files but don\'t commit')
      console.log('  --push         Also push commits to remote')
      console.log('\nRequires:')
      console.log('  - claude-console (or claude) CLI tool installed')
      console.log('  - Socket projects in parent directory')
      console.log('\nProjects synced:')
      SOCKET_PROJECTS.forEach(p => console.log(`  - ${p}`))
      process.exitCode = 0
      return
    }

    printHeader('CLAUDE.md Synchronization')

    // Check for Claude.
    log.step('Checking prerequisites')
    log.progress('Checking for Claude CLI')
    const claudeCmd = await checkClaude()
    if (!claudeCmd) {
      log.failed('claude-console not found')
      log.error('Please install claude-console: https://github.com/anthropics/claude-console')
      log.info('Install with: npm install -g @anthropic/claude-console')
      process.exitCode = 1
      return
    }
    log.done(`Found Claude CLI: ${claudeCmd}`)

    // Find Socket projects.
    log.progress('Finding Socket projects')
    const projects = await findSocketProjects()
    if (projects.length === 0) {
      log.failed('No Socket projects found')
      log.error('Expected projects in parent directory:')
      SOCKET_PROJECTS.forEach(p => log.substep(path.join(parentPath, p)))
      process.exitCode = 1
      return
    }
    log.done(`Found ${projects.length} Socket projects`)

    // Process socket-registry first (it's the canonical source).
    log.step('Updating canonical source')
    const registryProject = projects.find(p => p.name === 'socket-registry')
    if (registryProject) {
      const success = await updateProjectClaudeMd(claudeCmd, registryProject)
      if (!success && !values['dry-run']) {
        log.error('Failed to update canonical socket-registry/CLAUDE.md')
        process.exitCode = 1
        return
      }
    }

    // Process other projects.
    log.step('Updating project-specific files')
    for (const project of projects) {
      if (project.name === 'socket-registry') continue

      const success = await updateProjectClaudeMd(claudeCmd, project)
      if (!success && !values['dry-run']) {
        log.error(`Failed to update ${project.name}/CLAUDE.md`)
        // Continue with other projects.
      }
    }

    // Commit changes if not skipped.
    if (!values['skip-commit'] && !values['dry-run']) {
      log.step('Committing changes')

      for (const project of projects) {
        await commitChanges(project)
      }
    }

    // Push if requested.
    if (values.push && !values['dry-run']) {
      log.step('Pushing changes')

      for (const project of projects) {
        log.progress(`Pushing ${project.name}`)
        const pushResult = await runCommandWithOutput('git', ['push'], {
          cwd: project.path
        })

        if (pushResult.exitCode === 0) {
          log.done(`Pushed ${project.name}`)
        } else {
          log.failed(`Failed to push ${project.name}`)
        }
      }
    }

    printFooter('CLAUDE.md synchronization complete!')

    if (!values['skip-commit'] && !values['dry-run']) {
      log.info('\nNext steps:')
      if (!values.push) {
        log.substep('Review changes with: git log --oneline -n 5')
        log.substep('Push to remote with: git push (in each project)')
      } else {
        log.substep('Changes have been pushed to remote repositories')
      }
    }

    process.exitCode = 0
  } catch (error) {
    log.error(`Sync failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)