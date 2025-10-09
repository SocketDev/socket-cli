/**
 * @fileoverview Claude-powered utilities for Socket projects.
 * Provides various AI-assisted development tools and automations.
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

// Socket project names.
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
  const opts = { __proto__: null, ...options }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...opts,
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
  const opts = { __proto__: null, ...options }
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...opts,
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
 * Prepare Claude command arguments.
 * Adds --dangerously-skip-permissions by default (Let's get dangerous!)
 * unless --no-darkwing flag is used.
 */
function prepareClaudeArgs(args = [], options = {}) {
  const opts = { __proto__: null, ...options }
  // "Let's get dangerous!" - Darkwing Duck.
  if (!opts['no-darkwing']) {
    return ['--dangerously-skip-permissions', ...args]
  }
  return args
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
 * Create a Claude prompt for syncing CLAUDE.md files.
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
async function updateProjectClaudeMd(claudeCmd, project, options = {}) {
  const opts = { __proto__: null, ...options }
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
  const result = await runCommandWithOutput(claudeCmd, prepareClaudeArgs([], options), {
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

/**
 * Sync CLAUDE.md files across Socket projects.
 */
async function syncClaudeMd(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('CLAUDE.md Synchronization')

  // Find Socket projects.
  log.progress('Finding Socket projects')
  const projects = await findSocketProjects()
  if (projects.length === 0) {
    log.failed('No Socket projects found')
    log.error('Expected projects in parent directory:')
    SOCKET_PROJECTS.forEach(p => log.substep(path.join(parentPath, p)))
    return false
  }
  log.done(`Found ${projects.length} Socket projects`)

  // Process socket-registry first (it's the canonical source).
  log.step('Updating canonical source')
  const registryProject = projects.find(p => p.name === 'socket-registry')
  if (registryProject) {
    const success = await updateProjectClaudeMd(claudeCmd, registryProject, options)
    if (!success && !opts['dry-run']) {
      log.error('Failed to update canonical socket-registry/CLAUDE.md')
      return false
    }
  }

  // Process other projects.
  log.step('Updating project-specific files')
  for (const project of projects) {
    if (project.name === 'socket-registry') continue

    const success = await updateProjectClaudeMd(claudeCmd, project, options)
    if (!success && !opts['dry-run']) {
      log.error(`Failed to update ${project.name}/CLAUDE.md`)
      // Continue with other projects.
    }
  }

  // Commit changes if not skipped.
  if (!opts['skip-commit'] && !opts['dry-run']) {
    log.step('Committing changes')

    for (const project of projects) {
      await commitChanges(project)
    }
  }

  // Push if requested.
  if (opts.push && !opts['dry-run']) {
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

  if (!opts['skip-commit'] && !opts['dry-run']) {
    log.info('\nNext steps:')
    if (!opts.push) {
      log.substep('Review changes with: git log --oneline -n 5')
      log.substep('Push to remote with: git push (in each project)')
    } else {
      log.substep('Changes have been pushed to remote repositories')
    }
  }

  return true
}

/**
 * Scan a project for issues and generate a report.
 */
async function scanProjectForIssues(claudeCmd, project, options = {}) {
  const opts = { __proto__: null, ...options }
  const { name, path: projectPath } = project

  log.progress(`Scanning ${name} for issues`)

  // Find source files to scan.
  const filesToScan = []
  const extensions = ['.js', '.mjs', '.ts', '.mts', '.jsx', '.tsx']

  async function findFiles(dir, depth = 0) {
    if (depth > 5) return // Limit depth to avoid excessive scanning.

    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      // Skip common directories to ignore.
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage', '.cache'].includes(entry.name)) {
          continue
        }
        await findFiles(fullPath, depth + 1)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name)
        if (extensions.includes(ext)) {
          filesToScan.push(fullPath)
        }
      }
    }
  }

  await findFiles(projectPath)

  // Create scanning prompt.
  const prompt = `You are performing a security and quality audit on the ${name} project.

Scan for the following issues:
1. **Logic bugs**: Incorrect conditions, off-by-one errors, wrong operators
2. **Race conditions**: Async/await issues, promise handling, concurrent access
3. **Cross-platform issues**:
   - Hard-coded path separators (/ or \\)
   - System-specific assumptions
   - File path handling without path.join/path.resolve
   - Platform-specific commands without checks
4. **File system failure cases**:
   - Missing error handling for file operations
   - No checks for file/directory existence
   - Uncaught ENOENT, EACCES, EPERM errors
5. **Async failure cases**:
   - Unhandled promise rejections
   - Missing try/catch around async operations
   - Fire-and-forget promises
6. **HTTP/API issues**:
   - Missing timeout configurations
   - No retry logic for transient failures
   - Unhandled network errors
7. **Memory leaks**:
   - Event listeners not cleaned up
   - Large objects kept in closures
   - Circular references
8. **Security issues**:
   - Command injection vulnerabilities
   - Path traversal vulnerabilities
   - Unsafe use of eval or Function constructor
   - Hardcoded secrets or credentials

For each issue found, provide:
- File path and line number
- Issue type and severity (critical/high/medium/low)
- Description of the problem
- Suggested fix

Format your response as a JSON array:
[
  {
    "file": "path/to/file.js",
    "line": 42,
    "severity": "high",
    "type": "race-condition",
    "description": "Async operation without proper await",
    "fix": "Add await before the async call"
  }
]

Files to scan: ${filesToScan.length} files in ${name}

Provide ONLY the JSON array, nothing else.`

  // Call Claude to scan.
  const result = await runCommandWithOutput(claudeCmd, prepareClaudeArgs([], options), {
    input: prompt,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024 * 10 // 10MB buffer for large responses.
  })

  if (result.exitCode !== 0) {
    log.failed(`Failed to scan ${name}`)
    return null
  }

  log.done(`Scanned ${name}`)

  try {
    return JSON.parse(result.stdout.trim())
  } catch (e) {
    log.warn(`Failed to parse scan results for ${name}`)
    return null
  }
}

/**
 * Interactive fix session with Claude.
 */
async function interactiveFixSession(claudeCmd, scanResults, projects, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Interactive Fix Session')

  // Group issues by severity.
  const critical = []
  const high = []
  const medium = []
  const low = []

  for (const project in scanResults) {
    const issues = scanResults[project] || []
    for (const issue of issues) {
      issue.project = project
      switch (issue.severity) {
        case 'critical': critical.push(issue); break
        case 'high': high.push(issue); break
        case 'medium': medium.push(issue); break
        default: low.push(issue)
      }
    }
  }

  const totalIssues = critical.length + high.length + medium.length + low.length

  console.log('\nScan Results:')
  console.log(`  ${colors.red(`Critical: ${critical.length}`)}`)
  console.log(`  ${colors.yellow(`High: ${high.length}`)}`)
  console.log(`  ${colors.cyan(`Medium: ${medium.length}`)}`)
  console.log(`  ${colors.gray(`Low: ${low.length}`)}`)
  console.log(`  Total: ${totalIssues} issues found`)

  if (totalIssues === 0) {
    log.success('No issues found!')
    return
  }

  // Start interactive session.
  console.log('\n' + colors.blue('Starting interactive fix session with Claude...'))
  console.log('Claude will help you fix these issues.')
  console.log('Commands: fix <issue-number>, commit, push, exit\n')

  // Create a comprehensive prompt for Claude.
  const sessionPrompt = `You are helping fix security and quality issues in Socket projects.

Here are the issues found:

CRITICAL ISSUES:
${critical.map((issue, i) => `${i + 1}. [${issue.project}] ${issue.file}:${issue.line} - ${issue.description}`).join('\n') || 'None'}

HIGH SEVERITY:
${high.map((issue, i) => `${critical.length + i + 1}. [${issue.project}] ${issue.file}:${issue.line} - ${issue.description}`).join('\n') || 'None'}

MEDIUM SEVERITY:
${medium.map((issue, i) => `${critical.length + high.length + i + 1}. [${issue.project}] ${issue.file}:${issue.line} - ${issue.description}`).join('\n') || 'None'}

LOW SEVERITY:
${low.map((issue, i) => `${critical.length + high.length + medium.length + i + 1}. [${issue.project}] ${issue.file}:${issue.line} - ${issue.description}`).join('\n') || 'None'}

You can:
1. Fix specific issues by number
2. Create commits (no AI attribution)
3. Push changes to remote
4. Provide guidance on fixing issues

Start by recommending which issues to fix first.`

  // Launch Claude console in interactive mode.
  await runCommand(claudeCmd, prepareClaudeArgs([], options), {
    input: sessionPrompt,
    stdio: 'inherit'
  })
}

/**
 * Run security and quality scan on Socket projects.
 */
async function runSecurityScan(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Security & Quality Scanner')

  // Find projects to scan.
  log.step('Finding projects to scan')
  const projects = []

  if (opts['no-cross-repo']) {
    // Scan only current project.
    const currentProjectName = path.basename(rootPath)
    projects.push({
      name: currentProjectName,
      path: rootPath
    })
    log.info('Scanning current project only')
  } else {
    // Scan all Socket projects.
    for (const projectName of SOCKET_PROJECTS) {
      const projectPath = path.join(parentPath, projectName)
      if (existsSync(projectPath)) {
        projects.push({
          name: projectName,
          path: projectPath
        })
      }
    }
  }

  if (projects.length === 0) {
    log.error('No projects found to scan')
    return false
  }

  log.success(`Found ${projects.length} project(s) to scan`)

  // Scan each project.
  log.step('Scanning projects for issues')
  const scanResults = {}

  for (const project of projects) {
    const issues = await scanProjectForIssues(claudeCmd, project, options)
    if (issues) {
      scanResults[project.name] = issues
    }
  }

  // Generate report.
  if (!opts['no-report']) {
    log.step('Generating scan report')
    const reportPath = path.join(rootPath, 'security-scan-report.json')
    await fs.writeFile(reportPath, JSON.stringify(scanResults, null, 2))
    log.done(`Report saved to: ${reportPath}`)
  }

  // Start interactive session if not skipped.
  if (!opts['no-interactive']) {
    await interactiveFixSession(claudeCmd, scanResults, projects, options)
  }

  return true
}

/**
 * Run Claude-assisted commits across Socket projects.
 */
async function runClaudeCommit(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Claude-Assisted Commit')

  // Find projects to commit in.
  log.step('Finding projects to commit')
  const projects = []

  if (opts['no-cross-repo']) {
    // Commit only in current project.
    const currentProjectName = path.basename(rootPath)
    projects.push({
      name: currentProjectName,
      path: rootPath
    })
    log.info('Committing in current project only')
  } else {
    // Commit in all Socket projects with changes.
    for (const projectName of SOCKET_PROJECTS) {
      const projectPath = path.join(parentPath, projectName)
      if (existsSync(projectPath)) {
        // Check if project has changes.
        const statusResult = await runCommandWithOutput('git', ['status', '--porcelain'], {
          cwd: projectPath
        })

        if (statusResult.stdout.trim()) {
          projects.push({
            name: projectName,
            path: projectPath,
            changes: statusResult.stdout.trim()
          })
        }
      }
    }
  }

  if (projects.length === 0) {
    log.info('No projects with uncommitted changes found')
    return true
  }

  log.success(`Found ${projects.length} project(s) with changes`)

  // Process each project with changes.
  for (const project of projects) {
    log.step(`Processing ${project.name}`)

    // Show current changes.
    if (project.changes) {
      log.substep('Changes detected:')
      const changeLines = project.changes.split('\n')
      changeLines.slice(0, 10).forEach(line => log.substep(`  ${line}`))
      if (changeLines.length > 10) {
        log.substep(`  ... and ${changeLines.length - 10} more`)
      }
    }

    // Build the commit prompt.
    let prompt = `You are in the ${project.name} project directory at ${project.path}.

Review the changes and create commits following these rules:
1. Commit changes
2. Create small, atomic commits
3. Follow claude.md rules for commit messages
4. NO AI attribution in commit messages
5. Use descriptive, concise commit messages`

    if (opts['no-verify']) {
      prompt += `
6. Use --no-verify flag when committing (git commit --no-verify)`
    }

    prompt += `

Check the current git status, review changes, and commit them appropriately.
Remember: small commits, follow project standards, no AI attribution.`

    log.progress(`Committing changes in ${project.name}`)

    // Launch Claude console for this project.
    const commitResult = await runCommandWithOutput(claudeCmd, prepareClaudeArgs([], options), {
      input: prompt,
      cwd: project.path,
      stdio: 'inherit'
    })

    if (commitResult.exitCode === 0) {
      log.done(`Committed changes in ${project.name}`)
    } else {
      log.failed(`Failed to commit in ${project.name}`)
    }
  }

  // Optionally push changes.
  if (opts.push) {
    log.step('Pushing changes to remote')

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

  printFooter('Claude-assisted commits complete!')

  if (!opts.push) {
    log.info('\nNext steps:')
    log.substep('Review commits with: git log --oneline -n 5')
    log.substep('Push to remote with: git push (in each project)')
  }

  return true
}

/**
 * Review code changes before committing.
 */
async function runCodeReview(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Code Review')

  // Get git diff for staged changes.
  const diffResult = await runCommandWithOutput('git', ['diff', '--cached'])

  if (!diffResult.stdout.trim()) {
    log.info('No staged changes to review')
    log.substep('Stage changes with: git add <files>')
    return true
  }

  const prompt = `Review the following staged changes for:
1. Code quality and best practices
2. Security vulnerabilities
3. Performance issues
4. CLAUDE.md compliance
5. Cross-platform compatibility
6. Error handling
7. Test coverage needs

Provide specific feedback with file:line references.

${diffResult.stdout}

Format your review as constructive feedback with severity levels (critical/high/medium/low).`

  log.step('Starting code review with Claude')
  await runCommand(claudeCmd, prepareClaudeArgs([], opts), {
    input: prompt,
    stdio: 'inherit'
  })

  return true
}

/**
 * Analyze and manage dependencies.
 */
async function runDependencyAnalysis(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Dependency Analysis')

  // Read package.json.
  const packageJson = JSON.parse(await fs.readFile(path.join(rootPath, 'package.json'), 'utf8'))

  // Check for outdated packages.
  log.progress('Checking for outdated packages')
  const outdatedResult = await runCommandWithOutput('pnpm', ['outdated', '--json'])

  let outdatedPackages = {}
  try {
    outdatedPackages = JSON.parse(outdatedResult.stdout || '{}')
  } catch {
    // Ignore parse errors.
  }
  log.done('Dependency check complete')

  const prompt = `Analyze the dependencies for ${packageJson.name}:

Current dependencies:
${JSON.stringify(packageJson.dependencies || {}, null, 2)}

Current devDependencies:
${JSON.stringify(packageJson.devDependencies || {}, null, 2)}

Outdated packages:
${JSON.stringify(outdatedPackages, null, 2)}

Provide:
1. Security vulnerability analysis
2. Unused dependency detection
3. Update recommendations with migration notes
4. License compatibility check
5. Bundle size impact analysis
6. Alternative package suggestions

Focus on actionable recommendations.`

  await runCommand(claudeCmd, prepareClaudeArgs([], opts), {
    input: prompt,
    stdio: 'inherit'
  })

  return true
}

/**
 * Generate test cases for existing code.
 */
async function runTestGeneration(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Test Generation')

  const { positionals = [] } = opts
  const targetFile = positionals[0]

  if (!targetFile) {
    log.error('Please specify a file to generate tests for')
    log.substep('Usage: pnpm claude --test <file>')
    return false
  }

  const filePath = path.isAbsolute(targetFile) ? targetFile : path.join(rootPath, targetFile)

  if (!existsSync(filePath)) {
    log.error(`File not found: ${targetFile}`)
    return false
  }

  const fileContent = await fs.readFile(filePath, 'utf8')
  const fileName = path.basename(filePath)

  const prompt = `Generate comprehensive test cases for ${fileName}:

${fileContent}

Create unit tests that:
1. Cover all exported functions
2. Test edge cases and error conditions
3. Validate input/output contracts
4. Test async operations properly
5. Include proper setup/teardown
6. Use vitest testing framework
7. Follow Socket testing standards

Output the complete test file content.`

  log.step(`Generating tests for ${fileName}`)
  const result = await runCommandWithOutput(claudeCmd, prepareClaudeArgs([], opts), {
    input: prompt,
    stdio: ['pipe', 'pipe', 'pipe']
  })

  if (result.exitCode === 0 && result.stdout) {
    const testDir = path.join(rootPath, 'test')
    if (!existsSync(testDir)) {
      await fs.mkdir(testDir, { recursive: true })
    }

    const testFileName = fileName.replace(/\.(m?[jt]s)$/, '.test.$1')
    const testFilePath = path.join(testDir, testFileName)

    await fs.writeFile(testFilePath, result.stdout.trim())
    log.success(`Test file created: ${testFilePath}`)
  }

  return true
}

/**
 * Generate or update documentation.
 */
async function runDocumentation(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Documentation Generation')

  const { positionals = [] } = opts
  const targetPath = positionals[0] || rootPath

  const prompt = `Generate or update documentation for the project at ${targetPath}.

Tasks:
1. Generate JSDoc comments for functions lacking documentation
2. Create/update API documentation
3. Improve README if needed
4. Document complex algorithms
5. Add usage examples
6. Document configuration options

Follow Socket documentation standards.
Output the documentation updates or new content.`

  await runCommand(claudeCmd, [], {
    input: prompt,
    stdio: 'inherit',
    cwd: targetPath
  })

  return true
}

/**
 * Suggest code refactoring improvements.
 */
async function runRefactor(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Code Refactoring Analysis')

  const { positionals = [] } = opts
  const targetFile = positionals[0]

  if (!targetFile) {
    log.error('Please specify a file to refactor')
    log.substep('Usage: pnpm claude --refactor <file>')
    return false
  }

  const filePath = path.isAbsolute(targetFile) ? targetFile : path.join(rootPath, targetFile)

  if (!existsSync(filePath)) {
    log.error(`File not found: ${targetFile}`)
    return false
  }

  const fileContent = await fs.readFile(filePath, 'utf8')

  const prompt = `Analyze and suggest refactoring for this code:

${fileContent}

Identify and fix:
1. Code smells (long functions, duplicate code, etc.)
2. Performance bottlenecks
3. Readability issues
4. Maintainability problems
5. Design pattern improvements
6. SOLID principle violations
7. Socket coding standards compliance

Provide the refactored code with explanations.`

  await runCommand(claudeCmd, prepareClaudeArgs([], opts), {
    input: prompt,
    stdio: 'inherit'
  })

  return true
}

/**
 * Optimize code for performance.
 */
async function runOptimization(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Performance Optimization')

  const { positionals = [] } = opts
  const targetFile = positionals[0]

  if (!targetFile) {
    log.error('Please specify a file to optimize')
    log.substep('Usage: pnpm claude --optimize <file>')
    return false
  }

  const filePath = path.isAbsolute(targetFile) ? targetFile : path.join(rootPath, targetFile)

  if (!existsSync(filePath)) {
    log.error(`File not found: ${targetFile}`)
    return false
  }

  const fileContent = await fs.readFile(filePath, 'utf8')

  const prompt = `Analyze and optimize this code for performance:

${fileContent}

Focus on:
1. Algorithm complexity improvements
2. Memory allocation reduction
3. Async operation optimization
4. Caching opportunities
5. Loop optimizations
6. Data structure improvements
7. V8 optimization tips
8. Bundle size reduction

Provide optimized code with benchmarks/explanations.`

  await runCommand(claudeCmd, prepareClaudeArgs([], opts), {
    input: prompt,
    stdio: 'inherit'
  })

  return true
}

/**
 * Comprehensive security and quality audit.
 */
async function runAudit(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Security & Quality Audit')

  log.step('Gathering project information')

  // Run various checks.
  const [npmAudit, depCheck, licenseCheck] = await Promise.all([
    runCommandWithOutput('npm', ['audit', '--json']),
    runCommandWithOutput('pnpm', ['licenses', 'list', '--json']),
    fs.readFile(path.join(rootPath, 'package.json'), 'utf8')
  ])

  const packageJson = JSON.parse(licenseCheck)

  const prompt = `Perform a comprehensive audit of the project:

Package: ${packageJson.name}@${packageJson.version}

NPM Audit Results:
${npmAudit.stdout}

License Information:
${depCheck.stdout}

Analyze:
1. Security vulnerabilities (with severity and fixes)
2. License compliance issues
3. Dependency risks
4. Code quality metrics
5. Best practice violations
6. Outdated dependencies with breaking changes
7. Supply chain risks

Provide actionable recommendations with priorities.`

  await runCommand(claudeCmd, prepareClaudeArgs([], opts), {
    input: prompt,
    stdio: 'inherit'
  })

  return true
}

/**
 * Explain code or concepts.
 */
async function runExplain(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Code Explanation')

  const { positionals = [] } = opts
  const targetFile = positionals[0]

  if (!targetFile) {
    log.error('Please specify a file or concept to explain')
    log.substep('Usage: pnpm claude --explain <file|concept>')
    return false
  }

  // Check if it's a file or a concept.
  const filePath = path.isAbsolute(targetFile) ? targetFile : path.join(rootPath, targetFile)

  let prompt
  if (existsSync(filePath)) {
    const fileContent = await fs.readFile(filePath, 'utf8')
    prompt = `Explain this code in detail:

${fileContent}

Provide:
1. Overall purpose and architecture
2. Function-by-function breakdown
3. Algorithm explanations
4. Data flow analysis
5. Dependencies and interactions
6. Performance characteristics
7. Potential improvements

Make it educational and easy to understand.`
  } else {
    // Treat as a concept to explain.
    prompt = `Explain the concept: ${targetFile}

Provide:
1. Clear definition
2. How it works
3. Use cases
4. Best practices
5. Common pitfalls
6. Code examples
7. Related concepts

Focus on practical understanding for developers.`
  }

  await runCommand(claudeCmd, prepareClaudeArgs([], opts), {
    input: prompt,
    stdio: 'inherit'
  })

  return true
}

/**
 * Help with migrations.
 */
async function runMigration(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Migration Assistant')

  const { positionals = [] } = opts
  const migrationType = positionals[0]

  if (!migrationType) {
    log.info('Available migration types:')
    log.substep('node <version>    - Node.js version upgrade')
    log.substep('deps              - Dependency updates')
    log.substep('esm               - CommonJS to ESM')
    log.substep('typescript        - JavaScript to TypeScript')
    log.substep('vitest            - Jest/Mocha to Vitest')
    return false
  }

  const packageJson = JSON.parse(await fs.readFile(path.join(rootPath, 'package.json'), 'utf8'))

  const prompt = `Help migrate ${packageJson.name} for: ${migrationType}

Current setup:
${JSON.stringify(packageJson, null, 2)}

Provide:
1. Step-by-step migration guide
2. Breaking changes to address
3. Code modifications needed
4. Configuration updates
5. Testing strategy
6. Rollback plan
7. Common issues and solutions

Be specific and actionable.`

  await runCommand(claudeCmd, prepareClaudeArgs([], opts), {
    input: prompt,
    stdio: 'inherit'
  })

  return true
}

/**
 * Clean up code by removing unused elements.
 */
async function runCleanup(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Code Cleanup')

  log.step('Analyzing codebase for cleanup opportunities')

  const prompt = `Analyze the project and identify cleanup opportunities:

1. Unused imports and variables
2. Dead code paths
3. Commented-out code blocks
4. Duplicate code
5. Unused dependencies
6. Obsolete configuration
7. Empty files
8. Unreachable code

For each item found:
- Specify file and line numbers
- Explain why it can be removed
- Note any potential risks

Format as actionable tasks.`

  await runCommand(claudeCmd, [], {
    input: prompt,
    stdio: 'inherit',
    cwd: rootPath
  })

  return true
}

/**
 * Help with debugging issues.
 */
async function runDebug(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Debugging Assistant')

  const { positionals = [] } = opts
  const errorOrFile = positionals.join(' ')

  if (!errorOrFile) {
    log.error('Please provide an error message or stack trace')
    log.substep('Usage: pnpm claude --debug "<error message>"')
    log.substep('   or: pnpm claude --debug <log-file>')
    return false
  }

  let debugContent = errorOrFile

  // Check if it's a file.
  const possibleFile = path.isAbsolute(errorOrFile) ? errorOrFile : path.join(rootPath, errorOrFile)
  if (existsSync(possibleFile)) {
    debugContent = await fs.readFile(possibleFile, 'utf8')
  }

  const prompt = `Help debug this issue:

${debugContent}

Provide:
1. Root cause analysis
2. Step-by-step debugging approach
3. Potential fixes with code
4. Prevention strategies
5. Related issues to check
6. Testing to verify the fix

Be specific and actionable.`

  await runCommand(claudeCmd, prepareClaudeArgs([], opts), {
    input: prompt,
    stdio: 'inherit'
  })

  return true
}

/**
 * Show available Claude operations.
 */
function showOperations() {
  console.log('\nCore operations:')
  console.log('  --sync         Synchronize CLAUDE.md files across projects')
  console.log('  --commit       Create commits with Claude assistance')
  console.log('  --push         Create commits and push to remote')

  console.log('\nCode quality:')
  console.log('  --review       Review staged changes before committing')
  console.log('  --fix          Scan for bugs and security issues')
  console.log('  --refactor     Suggest code improvements')
  console.log('  --optimize     Performance optimization analysis')
  console.log('  --clean        Find unused code and imports')
  console.log('  --audit        Security and quality audit')

  console.log('\nDevelopment:')
  console.log('  --test         Generate test cases')
  console.log('  --docs         Generate documentation')
  console.log('  --explain      Explain code or concepts')
  console.log('  --debug        Help debug errors')
  console.log('  --deps         Analyze dependencies')
  console.log('  --migrate      Migration assistance')

  console.log('\nUtility:')
  console.log('  --help         Show this help message')
}

async function main() {
  try {
    // Parse arguments.
    const { values, positionals } = parseArgs({
      options: {
        // Core operations.
        help: {
          type: 'boolean',
          default: false,
        },
        sync: {
          type: 'boolean',
          default: false,
        },
        commit: {
          type: 'boolean',
          default: false,
        },
        push: {
          type: 'boolean',
          default: false,
        },
        // Code quality.
        review: {
          type: 'boolean',
          default: false,
        },
        fix: {
          type: 'boolean',
          default: false,
        },
        refactor: {
          type: 'boolean',
          default: false,
        },
        optimize: {
          type: 'boolean',
          default: false,
        },
        clean: {
          type: 'boolean',
          default: false,
        },
        audit: {
          type: 'boolean',
          default: false,
        },
        // Development.
        test: {
          type: 'boolean',
          default: false,
        },
        docs: {
          type: 'boolean',
          default: false,
        },
        explain: {
          type: 'boolean',
          default: false,
        },
        debug: {
          type: 'boolean',
          default: false,
        },
        deps: {
          type: 'boolean',
          default: false,
        },
        migrate: {
          type: 'boolean',
          default: false,
        },
        // Options.
        'no-verify': {
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
        'no-report': {
          type: 'boolean',
          default: false,
        },
        'no-interactive': {
          type: 'boolean',
          default: false,
        },
        'no-cross-repo': {
          type: 'boolean',
          default: false,
        },
        'no-darkwing': {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    // Check if any operation is specified.
    const hasOperation = values.sync || values.fix || values.commit || values.push ||
                        values.review || values.refactor || values.optimize || values.clean ||
                        values.audit || values.test || values.docs || values.explain ||
                        values.debug || values.deps || values.migrate

    // Show help if requested or no operation specified.
    if (values.help || !hasOperation) {
      console.log('\nUsage: pnpm claude [operation] [options] [files...]')
      console.log('\nClaude-powered utilities for Socket projects.')
      showOperations()
      console.log('\nOptions:')
      console.log('  --dry-run        Preview changes without writing files')
      console.log('  --skip-commit    Update files but don\'t commit')
      console.log('  --no-verify      Use --no-verify when committing')
      console.log('  --no-report      Skip generating scan report (--fix)')
      console.log('  --no-interactive Skip interactive fix session (--fix)')
      console.log('  --no-cross-repo  Operate on current project only')
      console.log('  --no-darkwing    Disable "Let\'s get dangerous!" mode')
      console.log('\nExamples:')
      console.log('  pnpm claude --review         # Review staged changes')
      console.log('  pnpm claude --fix            # Scan for issues')
      console.log('  pnpm claude --test lib/utils.js  # Generate tests for a file')
      console.log('  pnpm claude --explain path.join  # Explain a concept')
      console.log('  pnpm claude --refactor src/index.js  # Suggest refactoring')
      console.log('  pnpm claude --deps           # Analyze dependencies')
      console.log('  pnpm claude --push           # Commit and push changes')
      console.log('  pnpm claude --help           # Show this help')
      console.log('\nRequires:')
      console.log('  - claude-console (or claude) CLI tool installed')
      process.exitCode = 0
      return
    }

    // Check for Claude CLI.
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

    // Execute requested operation.
    let success = true
    const options = { ...values, positionals }

    // Core operations.
    if (values.sync) {
      success = await syncClaudeMd(claudeCmd, options)
    } else if (values.commit) {
      success = await runClaudeCommit(claudeCmd, options)
    } else if (values.push) {
      // --push combines commit and push.
      success = await runClaudeCommit(claudeCmd, { ...options, push: true })
    }
    // Code quality operations.
    else if (values.review) {
      success = await runCodeReview(claudeCmd, options)
    } else if (values.fix) {
      success = await runSecurityScan(claudeCmd, options)
    } else if (values.refactor) {
      success = await runRefactor(claudeCmd, options)
    } else if (values.optimize) {
      success = await runOptimization(claudeCmd, options)
    } else if (values.clean) {
      success = await runCleanup(claudeCmd, options)
    } else if (values.audit) {
      success = await runAudit(claudeCmd, options)
    }
    // Development operations.
    else if (values.test) {
      success = await runTestGeneration(claudeCmd, options)
    } else if (values.docs) {
      success = await runDocumentation(claudeCmd, options)
    } else if (values.explain) {
      success = await runExplain(claudeCmd, options)
    } else if (values.debug) {
      success = await runDebug(claudeCmd, options)
    } else if (values.deps) {
      success = await runDependencyAnalysis(claudeCmd, options)
    } else if (values.migrate) {
      success = await runMigration(claudeCmd, options)
    }

    process.exitCode = success ? 0 : 1
  } catch (error) {
    log.error(`Operation failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(console.error)