/**
 * @fileoverview Claude Code-powered utilities for Socket projects.
 * Provides various AI-assisted development tools and automations using Claude Code CLI.
 * Requires Claude Code (claude) CLI to be installed.
 */

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { deleteAsync as del } from 'del'
import colors from 'yoctocolors-cjs'

import { parseArgs } from '@socketsecurity/lib/argv/parse'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')
const parentPath = path.join(rootPath, '..')
const claudeDir = path.join(rootPath, '.claude')
const WIN32 = process.platform === 'win32'

// Socket project names.
const SOCKET_PROJECTS = [
  'socket-cli',
  'socket-lib',
  'socket-sdk-js',
  'socket-packageurl-js',
  'socket-registry',
]

// Storage paths.
// User-level (cross-repo, persistent)
const CLAUDE_HOME = path.join(os.homedir(), '.claude')
const STORAGE_PATHS = {
  fixMemory: path.join(CLAUDE_HOME, 'fix-memory.db'),
  stats: path.join(CLAUDE_HOME, 'stats.json'),
  history: path.join(CLAUDE_HOME, 'history.json'),
  config: path.join(CLAUDE_HOME, 'config.json'),
  cache: path.join(CLAUDE_HOME, 'cache'),
}

// Repo-level (per-project, temporary)
const REPO_STORAGE = {
  snapshots: path.join(claudeDir, 'snapshots'),
  session: path.join(claudeDir, 'session.json'),
  scratch: path.join(claudeDir, 'scratch'),
}

// Retention periods (milliseconds).
const RETENTION = {
  // 7 days
  snapshots: 7 * 24 * 60 * 60 * 1000,
  // 30 days
  cache: 30 * 24 * 60 * 60 * 1000,
  // 1 day
  sessions: 24 * 60 * 60 * 1000,
}

// Claude API pricing (USD per token).
// https://www.anthropic.com/pricing
const PRICING = {
  'claude-sonnet-4-5': {
    // $3 per 1M input tokens
    input: 3.0 / 1_000_000,
    // $15 per 1M output tokens
    output: 15.0 / 1_000_000,
    // $3.75 per 1M cache write tokens
    cache_write: 3.75 / 1_000_000,
    // $0.30 per 1M cache read tokens
    cache_read: 0.3 / 1_000_000,
  },
  'claude-sonnet-3-7': {
    // $3 per 1M input tokens
    input: 3.0 / 1_000_000,
    // $15 per 1M output tokens
    output: 15.0 / 1_000_000,
    // $3.75 per 1M cache write tokens
    cache_write: 3.75 / 1_000_000,
    // $0.30 per 1M cache read tokens
    cache_read: 0.3 / 1_000_000,
  },
}

// Simple inline logger.
const log = {
  info: msg => console.log(msg),
  error: msg => console.error(`${colors.red('✗')} ${msg}`),
  success: msg => console.log(`${colors.green('✓')} ${msg}`),
  step: msg => console.log(`\n${msg}`),
  substep: msg => console.log(`  ${msg}`),
  progress: msg => {
    process.stdout.write('\r\x1b[K')
    process.stdout.write(`  ∴ ${msg}`)
  },
  done: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.green('✓')} ${msg}`)
  },
  failed: msg => {
    process.stdout.write('\r\x1b[K')
    console.log(`  ${colors.red('✗')} ${msg}`)
  },
  warn: msg => console.log(`${colors.yellow('⚠')} ${msg}`),
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

/**
 * Initialize storage directories.
 */
async function initStorage() {
  await fs.mkdir(CLAUDE_HOME, { recursive: true })
  await fs.mkdir(STORAGE_PATHS.cache, { recursive: true })
  await fs.mkdir(REPO_STORAGE.snapshots, { recursive: true })
  await fs.mkdir(REPO_STORAGE.scratch, { recursive: true })
}

/**
 * Clean up old data using del package.
 */
async function cleanupOldData() {
  const now = Date.now()

  // Clean old snapshots in current repo.
  try {
    const snapshots = await fs.readdir(REPO_STORAGE.snapshots)
    const toDelete = []
    for (const snap of snapshots) {
      const snapPath = path.join(REPO_STORAGE.snapshots, snap)
      const stats = await fs.stat(snapPath)
      if (now - stats.mtime.getTime() > RETENTION.snapshots) {
        toDelete.push(snapPath)
      }
    }
    if (toDelete.length > 0) {
      // Force delete temp directories outside CWD.
      await del(toDelete, { force: true })
    }
  } catch {
    // Ignore errors if directory doesn't exist.
  }

  // Clean old cache entries in ~/.claude/cache/.
  try {
    const cached = await fs.readdir(STORAGE_PATHS.cache)
    const toDelete = []
    for (const file of cached) {
      const filePath = path.join(STORAGE_PATHS.cache, file)
      const stats = await fs.stat(filePath)
      if (now - stats.mtime.getTime() > RETENTION.cache) {
        toDelete.push(filePath)
      }
    }
    if (toDelete.length > 0) {
      // Force delete temp directories outside CWD.
      await del(toDelete, { force: true })
    }
  } catch {
    // Ignore errors if directory doesn't exist.
  }
}

/**
 * Cost tracking with budget controls.
 */
class CostTracker {
  constructor(model = 'claude-sonnet-4-5') {
    this.model = model
    this.session = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 }
    this.monthly = this.loadMonthlyStats()
    this.startTime = Date.now()
  }

  loadMonthlyStats() {
    try {
      if (existsSync(STORAGE_PATHS.stats)) {
        const data = JSON.parse(fs.readFileSync(STORAGE_PATHS.stats, 'utf8'))
        // YYYY-MM
        const currentMonth = new Date().toISOString().slice(0, 7)
        if (data.month === currentMonth) {
          return data
        }
      }
    } catch {
      // Ignore errors, start fresh.
    }
    return {
      month: new Date().toISOString().slice(0, 7),
      cost: 0,
      fixes: 0,
      sessions: 0,
    }
  }

  saveMonthlyStats() {
    try {
      fs.writeFileSync(
        STORAGE_PATHS.stats,
        JSON.stringify(this.monthly, null, 2),
      )
    } catch {
      // Ignore errors.
    }
  }

  track(usage) {
    const pricing = PRICING[this.model]
    if (!pricing) {
      return
    }

    const inputTokens = usage.input_tokens || 0
    const outputTokens = usage.output_tokens || 0
    const cacheWriteTokens = usage.cache_creation_input_tokens || 0
    const cacheReadTokens = usage.cache_read_input_tokens || 0

    const cost =
      inputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheWriteTokens * pricing.cache_write +
      cacheReadTokens * pricing.cache_read

    this.session.input += inputTokens
    this.session.output += outputTokens
    this.session.cacheWrite += cacheWriteTokens
    this.session.cacheRead += cacheReadTokens
    this.session.cost += cost

    this.monthly.cost += cost
    this.saveMonthlyStats()
  }

  showSessionSummary() {
    const duration = Date.now() - this.startTime
    console.log(colors.cyan('\n💰 Cost Summary:'))
    console.log(`  Input tokens: ${this.session.input.toLocaleString()}`)
    console.log(`  Output tokens: ${this.session.output.toLocaleString()}`)
    if (this.session.cacheWrite > 0) {
      console.log(`  Cache write: ${this.session.cacheWrite.toLocaleString()}`)
    }
    if (this.session.cacheRead > 0) {
      console.log(`  Cache read: ${this.session.cacheRead.toLocaleString()}`)
    }
    console.log(
      `  Session cost: ${colors.green(`$${this.session.cost.toFixed(4)}`)}`,
    )
    console.log(
      `  Monthly total: ${colors.yellow(`$${this.monthly.cost.toFixed(2)}`)}`,
    )
    console.log(`  Duration: ${colors.gray(formatDuration(duration))}`)
  }
}

/**
 * Format duration in human-readable form.
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

/**
 * Progress tracking with ETA estimation.
 */
class ProgressTracker {
  constructor() {
    this.phases = []
    this.currentPhase = null
    this.startTime = Date.now()
    this.history = this.loadHistory()
  }

  loadHistory() {
    try {
      if (existsSync(STORAGE_PATHS.history)) {
        const data = JSON.parse(fs.readFileSync(STORAGE_PATHS.history, 'utf8'))
        // Keep only last 50 sessions.
        return data.sessions.slice(-50)
      }
    } catch {
      // Ignore errors.
    }
    return []
  }

  saveHistory() {
    try {
      const data = {
        sessions: [
          ...this.history,
          { phases: this.phases, timestamp: Date.now() },
        ],
      }
      // Keep only last 50 sessions.
      if (data.sessions.length > 50) {
        data.sessions = data.sessions.slice(-50)
      }
      fs.writeFileSync(STORAGE_PATHS.history, JSON.stringify(data, null, 2))
    } catch {
      // Ignore errors.
    }
  }

  startPhase(name) {
    if (this.currentPhase) {
      this.endPhase()
    }
    this.currentPhase = { name, start: Date.now() }
  }

  endPhase() {
    if (this.currentPhase) {
      this.currentPhase.duration = Date.now() - this.currentPhase.start
      this.phases.push(this.currentPhase)
      this.currentPhase = null
    }
  }

  estimateETA(phaseName) {
    // Find similar past sessions.
    const similar = this.history.filter(s =>
      s.phases.some(p => p.name === phaseName),
    )
    if (similar.length === 0) {
      return null
    }

    // Get median duration for this phase.
    const durations = similar
      .map(s => s.phases.find(p => p.name === phaseName)?.duration)
      .filter(d => d)
      .sort((a, b) => a - b)

    if (durations.length === 0) {
      return null
    }

    const median = durations[Math.floor(durations.length / 2)]
    return median
  }

  getTotalETA() {
    // Sum up remaining phases based on historical data.
    const remaining = ['local-checks', 'commit', 'ci-monitor'].filter(
      p => !this.phases.some(ph => ph.name === p),
    )

    let total = 0
    for (const phase of remaining) {
      const eta = this.estimateETA(phase)
      if (eta) {
        total += eta
      }
    }

    // Add current phase remaining time.
    if (this.currentPhase) {
      const eta = this.estimateETA(this.currentPhase.name)
      if (eta) {
        const elapsed = Date.now() - this.currentPhase.start
        total += Math.max(0, eta - elapsed)
      }
    }

    return total > 0 ? total : null
  }

  showProgress() {
    const totalElapsed = Date.now() - this.startTime
    const eta = this.getTotalETA()

    console.log(colors.cyan('\n⏱️  Progress:'))
    console.log(`  Elapsed: ${formatDuration(totalElapsed)}`)
    if (eta) {
      console.log(`  ETA: ${formatDuration(eta)}`)
    }

    if (this.currentPhase) {
      const phaseElapsed = Date.now() - this.currentPhase.start
      console.log(
        colors.gray(
          `  Current: ${this.currentPhase.name} (${formatDuration(phaseElapsed)})`,
        ),
      )
    }

    // Show completed phases.
    if (this.phases.length > 0) {
      console.log(colors.gray('  Completed:'))
      this.phases.forEach(p => {
        console.log(
          colors.gray(
            `    ${colors.green('✓')} ${p.name} (${formatDuration(p.duration)})`,
          ),
        )
      })
    }
  }

  complete() {
    this.endPhase()
    this.saveHistory()
  }
}

/**
 * Snapshot system for smart rollback.
 */
class SnapshotManager {
  constructor() {
    this.snapshots = []
  }

  async createSnapshot(label) {
    const sha = await runCommandWithOutput('git', ['rev-parse', 'HEAD'], {
      cwd: rootPath,
    })
    const diff = await runCommandWithOutput('git', ['diff', 'HEAD'], {
      cwd: rootPath,
    })

    const snapshot = {
      label,
      sha: sha.stdout.trim(),
      diff: diff.stdout,
      timestamp: Date.now(),
    }

    this.snapshots.push(snapshot)

    // Save snapshot to disk.
    const snapshotPath = path.join(
      REPO_STORAGE.snapshots,
      `snapshot-${Date.now()}.json`,
    )
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2))

    return snapshot
  }

  async rollback(steps = 1) {
    if (this.snapshots.length < steps) {
      log.warn(`Only ${this.snapshots.length} snapshot(s) available`)
      return false
    }

    const target = this.snapshots[this.snapshots.length - steps]
    log.warn(`Rolling back ${steps} fix(es) to: ${target.label}`)

    await runCommand('git', ['reset', '--hard', target.sha], { cwd: rootPath })

    // Re-apply diff if there was one.
    if (target.diff) {
      await runCommand('git', ['apply'], {
        cwd: rootPath,
        input: target.diff,
      })
    }

    log.done('Rollback complete')
    return true
  }

  listSnapshots() {
    console.log(colors.cyan('\n📸 Available Snapshots:'))
    this.snapshots.forEach((snap, i) => {
      const age = formatDuration(Date.now() - snap.timestamp)
      console.log(
        `  ${i + 1}. ${snap.label} ${colors.gray(`(${age} ago, ${snap.sha.substring(0, 7)})`)}`,
      )
    })
  }
}

/**
 * Proactive pre-commit detection.
 */
async function runPreCommitScan(claudeCmd) {
  log.step('Running proactive pre-commit scan')

  const staged = await runCommandWithOutput(
    'git',
    ['diff', '--cached', '--name-only'],
    {
      cwd: rootPath,
    },
  )

  if (!staged.stdout.trim()) {
    log.substep('No staged files to scan')
    return { issues: [], safe: true }
  }

  const files = staged.stdout.trim().split('\n')
  log.substep(`Scanning ${files.length} staged file(s)`)

  const diff = await runCommandWithOutput('git', ['diff', '--cached'], {
    cwd: rootPath,
  })

  const prompt = `You are performing a quick pre-commit scan to catch likely CI failures.

**Staged Changes:**
\`\`\`diff
${diff.stdout}
\`\`\`

**Task:** Analyze these changes for potential CI failures.

**Check for:**
- Type errors
- Lint violations (missing semicolons, unused vars, etc.)
- Breaking API changes
- Missing tests for new functionality
- console.log statements
- debugger statements
- .only() or .skip() in tests

**Output Format (JSON):**
{
  "issues": [
    {
      "severity": "high|medium|low",
      "type": "type-error|lint|test|other",
      "description": "Brief description of the issue",
      "file": "path/to/file.ts",
      "confidence": 85
    }
  ],
  "safe": false
}

**Rules:**
- Only report issues with >60% confidence
- Be specific about file and line if possible
- Mark safe=true if no issues found
- Don't report style issues that auto-fix will handle`

  try {
    const result = await runCommandWithOutput(
      claudeCmd,
      [
        'code',
        '--non-interactive',
        '--output-format',
        'text',
        '--prompt',
        prompt,
      ],
      { cwd: rootPath, timeout: 30_000 },
    )

    if (result.exitCode !== 0) {
      log.substep('Scan completed (no issues detected)')
      return { issues: [], safe: true }
    }

    // Parse JSON response.
    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { issues: [], safe: true }
    }

    const scan = JSON.parse(jsonMatch[0])
    return scan
  } catch (e) {
    log.warn(`Scan error: ${e.message}`)
    return { issues: [], safe: true }
  }
}

/**
 * Success celebration with stats.
 */
async function celebrateSuccess(costTracker, stats = {}) {
  const messages = [
    "🎉 CI is green! You're a legend!",
    "✨ All tests passed! Claude's got your back!",
    '🚀 Ship it! CI is happy!',
    '💚 Green as a well-tested cucumber!',
    '🏆 Victory! All checks passed!',
    '⚡ Flawless execution! CI approved!',
  ]

  const message = messages[Math.floor(Math.random() * messages.length)]
  log.success(message)

  // Show session stats.
  if (costTracker) {
    costTracker.showSessionSummary()
  }

  // Show fix details if available.
  if (stats.fixCount > 0) {
    console.log(colors.cyan('\n📊 Session Stats:'))
    console.log(`  Fixes applied: ${stats.fixCount}`)
    console.log(`  Retries: ${stats.retries || 0}`)
  }

  // Update success streak.
  try {
    const streakPath = path.join(CLAUDE_HOME, 'streak.json')
    let streak = { current: 0, best: 0, lastSuccess: null }
    if (existsSync(streakPath)) {
      streak = JSON.parse(await fs.readFile(streakPath, 'utf8'))
    }

    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000

    // Reset streak if last success was more than 24h ago.
    if (streak.lastSuccess && streak.lastSuccess < oneDayAgo) {
      streak.current = 1
    } else {
      streak.current += 1
    }

    streak.best = Math.max(streak.best, streak.current)
    streak.lastSuccess = now

    await fs.writeFile(streakPath, JSON.stringify(streak, null, 2))

    console.log(colors.cyan('\n🔥 Success Streak:'))
    console.log(`  Current: ${streak.current}`)
    console.log(`  Best: ${streak.best}`)
  } catch {
    // Ignore errors.
  }
}

/**
 * Analyze error to identify root cause and suggest fix strategies.
 */
async function analyzeRootCause(claudeCmd, error, context = {}) {
  const ctx = { __proto__: null, ...context }
  const errorHash = hashError(error)

  // Check cache first.
  const cachePath = path.join(STORAGE_PATHS.cache, `analysis-${errorHash}.json`)
  try {
    if (existsSync(cachePath)) {
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'))
      const age = Date.now() - cached.timestamp
      // Cache valid for 1 hour.
      if (age < 60 * 60 * 1000) {
        log.substep(colors.gray('Using cached analysis'))
        return cached.analysis
      }
    }
  } catch {
    // Ignore cache errors.
  }

  // Load error history for learning.
  const history = await loadErrorHistory()
  const similarErrors = findSimilarErrors(errorHash, history)

  log.progress('Analyzing root cause with Claude')

  const prompt = `You are an expert software engineer analyzing a CI/test failure.

**Error Output:**
\`\`\`
${error}
\`\`\`

**Context:**
- Check name: ${ctx.checkName || 'Unknown'}
- Repository: ${ctx.repoName || 'Unknown'}
- Previous attempts: ${ctx.attempts || 0}

${similarErrors.length > 0 ? `**Similar Past Errors:**\n${similarErrors.map(e => `- ${e.description}: ${e.outcome} (${e.strategy})`).join('\n')}\n` : ''}

**Task:** Analyze this error and provide a structured diagnosis.

**Output Format (JSON):**
{
  "rootCause": "Brief description of the actual problem (not symptoms)",
  "confidence": 85,  // 0-100% how certain you are
  "category": "type-error|lint|test-failure|build-error|env-issue|other",
  "isEnvironmental": false,  // true if likely GitHub runner/network/rate-limit issue
  "strategies": [
    {
      "name": "Fix type assertion",
      "probability": 90,  // 0-100% estimated success probability
      "description": "Add type assertion to resolve type mismatch",
      "reasoning": "Error shows TypeScript expecting string but got number"
    },
    {
      "name": "Update import",
      "probability": 60,
      "description": "Update import path or module resolution",
      "reasoning": "Might be module resolution issue"
    }
  ],
  "environmentalFactors": [
    "Check if GitHub runner has sufficient memory",
    "Verify network connectivity for package downloads"
  ],
  "explanation": "Detailed explanation of what's happening and why"
}

**Rules:**
- Be specific about the root cause, not just symptoms
- Rank strategies by success probability (highest first)
- Include 1-3 strategies maximum
- Mark as environmental if it's likely a runner/network/external issue
- Use confidence scores honestly (50-70% = uncertain, 80-95% = confident, 95-100% = very confident)`

  try {
    const result = await runCommandWithOutput(
      claudeCmd,
      [
        'code',
        '--non-interactive',
        '--output-format',
        'text',
        '--prompt',
        prompt,
      ],
      { cwd: rootPath },
    )

    if (result.exitCode !== 0) {
      log.warn('Analysis failed, proceeding without root cause info')
      return null
    }

    // Parse JSON response.
    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log.warn('Could not parse analysis, proceeding without root cause info')
      return null
    }

    const analysis = JSON.parse(jsonMatch[0])

    // Cache the analysis.
    try {
      await fs.writeFile(
        cachePath,
        JSON.stringify(
          {
            analysis,
            errorHash,
            timestamp: Date.now(),
          },
          null,
          2,
        ),
      )
    } catch {
      // Ignore cache write errors.
    }

    return analysis
  } catch (e) {
    log.warn(`Analysis error: ${e.message}`)
    return null
  }
}

/**
 * Load error history from storage.
 */
async function loadErrorHistory() {
  const historyPath = path.join(CLAUDE_HOME, 'error-history.json')
  try {
    if (existsSync(historyPath)) {
      const data = JSON.parse(await fs.readFile(historyPath, 'utf8'))
      // Only return recent history (last 100 errors).
      return data.errors.slice(-100)
    }
  } catch {
    // Ignore errors.
  }
  return []
}

/**
 * Save error outcome to history for learning.
 */
async function saveErrorHistory(errorHash, outcome, strategy, description) {
  const historyPath = path.join(CLAUDE_HOME, 'error-history.json')
  try {
    let data = { errors: [] }
    if (existsSync(historyPath)) {
      data = JSON.parse(await fs.readFile(historyPath, 'utf8'))
    }

    // 'success' | 'failed'
    data.errors.push({
      errorHash,
      outcome,
      strategy,
      description,
      timestamp: Date.now(),
    })

    // Keep only last 200 errors.
    if (data.errors.length > 200) {
      data.errors = data.errors.slice(-200)
    }

    await fs.writeFile(historyPath, JSON.stringify(data, null, 2))
  } catch {
    // Ignore errors.
  }
}

/**
 * Find similar errors from history.
 */
function findSimilarErrors(errorHash, history) {
  return history
    .filter(e => e.errorHash === errorHash && e.outcome === 'success')
    .slice(-3)
}

/**
 * Display root cause analysis to user.
 */
function displayAnalysis(analysis) {
  if (!analysis) {
    return
  }

  console.log(colors.cyan('\n🔍 Root Cause Analysis:'))
  console.log(
    `  Cause: ${analysis.rootCause} ${colors.gray(`(${analysis.confidence}% confident)`)}`,
  )
  console.log(`  Category: ${analysis.category}`)

  if (analysis.isEnvironmental) {
    console.log(
      colors.yellow(
        '\n  ⚠ This appears to be an environmental issue (runner/network/external)',
      ),
    )
    if (analysis.environmentalFactors.length > 0) {
      console.log(colors.yellow('  Factors to check:'))
      analysis.environmentalFactors.forEach(factor => {
        console.log(colors.yellow(`    - ${factor}`))
      })
    }
  }

  if (analysis.strategies.length > 0) {
    console.log(
      colors.cyan('\n💡 Fix Strategies (ranked by success probability):'),
    )
    analysis.strategies.forEach((strategy, i) => {
      console.log(
        `  ${i + 1}. ${colors.bold(strategy.name)} ${colors.gray(`(${strategy.probability}%)`)}`,
      )
      console.log(`     ${strategy.description}`)
      console.log(colors.gray(`     ${strategy.reasoning}`))
    })
  }

  if (analysis.explanation) {
    console.log(colors.cyan('\n📖 Explanation:'))
    console.log(colors.gray(`  ${analysis.explanation}`))
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
  const { input, ...spawnOpts } = opts

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const child = spawn(command, args, {
      cwd: rootPath,
      ...(WIN32 && { shell: true }),
      ...spawnOpts,
    })

    // Write input to stdin if provided.
    if (input && child.stdin) {
      child.stdin.write(input)
      child.stdin.end()
    }

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

// Simple cache for Claude responses with automatic cleanup
const claudeCache = new Map()
// 5 minutes
const CACHE_TTL = 5 * 60 * 1000

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of claudeCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      claudeCache.delete(key)
    }
  }
  // unref() allows process to exit if this is the only timer.
}, CACHE_TTL).unref()

/**
 * Run Claude Code with a prompt.
 * Handles caching, model tracking, and retry logic.
 */
async function runClaude(claudeCmd, prompt, options = {}) {
  const opts = { __proto__: null, ...options }
  const args = prepareClaudeArgs([], opts)

  // Determine mode for ultrathink decision.
  const task = prompt.slice(0, 100)
  const forceModel = opts['the-brain']
    ? 'the-brain'
    : opts.pinky
      ? 'pinky'
      : null
  const mode = modelStrategy.selectMode(task, {
    forceModel,
    lastError: opts.lastError,
  })

  // Prepend ultrathink directive when using The Brain mode.
  // Ultrathink is Claude's most intensive thinking mode, providing maximum
  // thinking budget for deep analysis and complex problem-solving.
  // Learn more: https://www.anthropic.com/engineering/claude-code-best-practices
  let enhancedPrompt = prompt
  if (mode === 'the-brain') {
    enhancedPrompt = `ultrathink\n\n${prompt}`
    log.substep('🧠 The Brain activated with ultrathink mode')
  }

  // Check cache for non-interactive requests
  if (opts.interactive === false && opts.cache !== false) {
    const cacheKey = `${enhancedPrompt.slice(0, 100)}_${mode}`
    const cached = claudeCache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      log.substep('📦 Using cached response')
      return cached.result
    }
  }

  let result

  // Default timeout: 3 minutes for non-interactive, 10 minutes for interactive
  const timeout =
    opts.timeout || (opts.interactive === false ? 180_000 : 600_000)
  const showProgress = opts.showProgress !== false && opts.interactive === false
  const startTime = Date.now()
  let progressInterval = null
  let timedOut = false

  try {
    if (opts.interactive !== false) {
      // Interactive mode - spawn with inherited stdio and pipe prompt
      result = await new Promise((resolve, _reject) => {
        const child = spawn(claudeCmd, args, {
          stdio: ['pipe', 'inherit', 'inherit'],
          cwd: opts.cwd || rootPath,
          ...(WIN32 && { shell: true }),
        })

        // Set up timeout for interactive mode
        const timeoutId = setTimeout(() => {
          timedOut = true
          log.warn(
            `Claude interactive session timed out after ${Math.round(timeout / 1000)}s`,
          )
          child.kill()
          resolve(1)
        }, timeout)

        // Write the prompt to stdin
        if (enhancedPrompt) {
          child.stdin.write(enhancedPrompt)
          child.stdin.end()
        }

        child.on('exit', code => {
          clearTimeout(timeoutId)
          resolve(code || 0)
        })

        child.on('error', () => {
          clearTimeout(timeoutId)
          resolve(1)
        })
      })
    } else {
      // Non-interactive mode - capture output with progress

      // Show initial progress if enabled
      if (showProgress && !opts.silent) {
        log.progress('Claude analyzing...')

        // Set up progress interval
        progressInterval = setInterval(() => {
          const elapsed = Date.now() - startTime
          if (elapsed > timeout) {
            timedOut = true
            log.warn(`Claude timed out after ${Math.round(elapsed / 1000)}s`)
            if (progressInterval) {
              clearInterval(progressInterval)
              progressInterval = null
            }
          } else {
            log.progress(
              `Claude processing... (${Math.round(elapsed / 1000)}s)`,
            )
          }
          // Update every 10 seconds.
        }, 10_000)
      }

      // Run command with timeout
      result = await Promise.race([
        runCommandWithOutput(claudeCmd, args, {
          ...opts,
          input: enhancedPrompt,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
        new Promise(resolve => {
          setTimeout(() => {
            if (!timedOut) {
              timedOut = true
              resolve({
                exitCode: 1,
                stdout: '',
                stderr: 'Operation timed out',
              })
            }
          }, timeout)
        }),
      ])

      // Clear progress interval
      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
        if (!opts.silent && !timedOut) {
          const elapsed = Date.now() - startTime
          log.done(`Claude completed in ${Math.round(elapsed / 1000)}s`)
        }
      }

      // Cache the result
      if (opts.cache !== false && result.exitCode === 0 && !timedOut) {
        const cacheKey = `${prompt.slice(0, 100)}_${opts._selectedModel || 'default'}`
        claudeCache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        })
      }
    }

    // Record success for model strategy
    modelStrategy.recordAttempt(task, true)

    return result
  } catch (error) {
    // Record failure for potential escalation
    modelStrategy.recordAttempt(task, false)

    // Check if we should retry with Brain
    const attempts = modelStrategy.attempts.get(modelStrategy.getTaskKey(task))
    if (attempts === modelStrategy.escalationThreshold && !opts['the-brain']) {
      log.warn('🧠 Pinky failed, escalating to The Brain...')
      opts['the-brain'] = true
      return runClaude(claudeCmd, prompt, opts)
    }

    throw error
  }
}

/**
 * Check if Claude Code CLI is available.
 */
async function checkClaude() {
  const checkCommand = WIN32 ? 'where' : 'which'

  log.progress('Checking for Claude Code CLI')

  // Check for 'claude' command (Claude Code)
  const result = await runCommandWithOutput(checkCommand, ['claude'])
  if (result.exitCode === 0) {
    log.done('Found Claude Code CLI (claude)')
    return 'claude'
  }

  // Check for 'ccp' as alternative
  log.progress('Checking for alternative CLI (ccp)')
  const ccpResult = await runCommandWithOutput(checkCommand, ['ccp'])
  if (ccpResult.exitCode === 0) {
    log.done('Found Claude Code CLI (ccp)')
    return 'ccp'
  }

  log.failed('Claude Code CLI not found')
  return false
}

/**
 * Ensure Claude Code is authenticated, prompting for authentication if needed.
 * Returns true if authenticated, false if unable to authenticate.
 */
async function ensureClaudeAuthenticated(claudeCmd) {
  let attempts = 0
  const maxAttempts = 3

  while (attempts < maxAttempts) {
    // Check if Claude is working by checking version
    log.progress('Checking Claude Code status')
    const versionCheck = await runCommandWithOutput(claudeCmd, ['--version'])

    if (versionCheck.exitCode === 0) {
      // Claude Code is installed and working
      // Check if we need to login by testing actual Claude functionality
      log.progress(
        'Testing Claude authentication (this may take up to 15 seconds)',
      )

      const testPrompt =
        'Respond with only the word "AUTHENTICATED" if you receive this message.'
      const startTime = Date.now()

      // Set up progress interval for the 15-second test
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime
        log.progress(
          `Testing authentication... (${Math.round(elapsed / 1000)}s/15s)`,
        )
        // Update every 3 seconds.
      }, 3000)

      const testResult = await runCommandWithOutput(claudeCmd, ['--print'], {
        input: testPrompt,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_OUTPUT_MODE: 'text' },
        timeout: 15_000,
      })

      clearInterval(progressInterval)

      // Check for authentication errors
      const output = (testResult.stdout + testResult.stderr).toLowerCase()
      const authErrors = [
        'not logged in',
        'authentication',
        'unauthorized',
        'login required',
        'please login',
        'api key',
      ]

      const needsAuth = authErrors.some(error => output.includes(error))
      const authenticated = output.includes('authenticated')

      if (!needsAuth && (authenticated || testResult.exitCode === 0)) {
        log.done('Claude Code ready')
        return true
      }

      if (!needsAuth && testResult.stdout.length > 10) {
        // Claude responded with something, likely working
        log.done('Claude Code ready')
        return true
      }
    }

    attempts++

    if (attempts >= maxAttempts) {
      log.error(`Failed to setup Claude Code after ${maxAttempts} attempts`)
      return false
    }

    // Not authenticated, provide instructions for manual authentication
    log.warn('Claude Code login required')
    console.log(colors.yellow('\nClaude Code needs to be authenticated.'))
    console.log('\nTo authenticate:')
    console.log('  1. Open a new terminal')
    console.log(`  2. Run: ${colors.green('claude')}`)
    console.log('  3. Follow the browser authentication prompts')
    console.log(
      '  4. Once authenticated, return here and press Enter to continue',
    )

    // Wait for user to press Enter
    await new Promise(resolve => {
      process.stdin.once('data', () => {
        resolve()
      })
    })

    // Give it a moment for the auth to register
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return false
}

/**
 * Ensure GitHub CLI is authenticated, prompting for login if needed.
 * Returns true if authenticated, false if unable to authenticate.
 */
async function ensureGitHubAuthenticated() {
  let attempts = 0
  const maxAttempts = 3

  while (attempts < maxAttempts) {
    log.progress('Checking GitHub authentication')
    const authCheck = await runCommandWithOutput('gh', ['auth', 'status'])

    if (authCheck.exitCode === 0) {
      log.done('GitHub CLI authenticated')
      return true
    }

    attempts++

    if (attempts >= maxAttempts) {
      log.error(
        `Failed to authenticate with GitHub after ${maxAttempts} attempts`,
      )
      return false
    }

    // Not authenticated, prompt for login
    log.warn('GitHub authentication required')
    console.log(colors.yellow('\nYou need to authenticate with GitHub.'))
    console.log('Follow the prompts to complete authentication.\n')

    // Run gh auth login interactively
    log.progress('Starting GitHub login process')
    const loginResult = await runCommand('gh', ['auth', 'login'], {
      stdio: 'inherit',
    })

    if (loginResult === 0) {
      log.done('Login process completed')
      // Give it a moment for the auth to register
      await new Promise(resolve => setTimeout(resolve, 2000))
    } else {
      log.failed('Login process failed')
      console.log(colors.red('\nLogin failed. Please try again.'))

      if (attempts < maxAttempts) {
        console.log(
          colors.yellow(`\nAttempt ${attempts + 1} of ${maxAttempts}`),
        )
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }

  return false
}

/**
 * Check if a commit SHA is part of a pull request.
 * @param {string} sha - The commit SHA to check
 * @param {string} owner - The repository owner
 * @param {string} repo - The repository name
 * @returns {Promise<{isPR: boolean, prNumber?: number, prTitle?: string}>}
 */
async function checkIfCommitIsPartOfPR(sha, owner, repo) {
  try {
    const result = await runCommandWithOutput('gh', [
      'pr',
      'list',
      '--repo',
      `${owner}/${repo}`,
      '--state',
      'all',
      '--search',
      sha,
      '--json',
      'number,title,state',
      '--limit',
      '1',
    ])

    if (result.exitCode === 0 && result.stdout) {
      const prs = JSON.parse(result.stdout)
      if (prs.length > 0) {
        const pr = prs[0]
        return {
          isPR: true,
          prNumber: pr.number,
          prTitle: pr.title,
          prState: pr.state,
        }
      }
    }
  } catch (e) {
    log.warn(`Failed to check if commit is part of PR: ${e.message}`)
  }

  return { isPR: false }
}

/**
 * Create a semantic hash of error output for tracking duplicate errors.
 * Normalizes errors to catch semantically identical issues with different line numbers.
 * @param {string} errorOutput - The error output to hash
 * @returns {string} A hex hash of the normalized error
 */
function hashError(errorOutput) {
  // Normalize error for semantic comparison
  const normalized = errorOutput
    .trim()
    // Remove timestamps
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^Z\s]*/g, 'TIMESTAMP')
    .replace(/\d{2}:\d{2}:\d{2}/g, 'TIME')
    // Remove line:column numbers (but keep file paths)
    .replace(/:\d+:\d+/g, ':*:*')
    .replace(/line \d+/gi, 'line *')
    .replace(/column \d+/gi, 'column *')
    // Remove specific SHAs and commit hashes
    .replace(/\b[0-9a-f]{7,40}\b/g, 'SHA')
    // Remove absolute file system paths (keep relative paths)
    .replace(/\/[^\s]*?\/([^/\s]+)/g, '$1')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Take first 500 chars (increased from 200 for better matching)
    .slice(0, 500)

  // Use proper cryptographic hashing for consistent results
  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Model strategy for intelligent Pinky/Brain switching.
 * "Gee, Brain, what do you want to do tonight?"
 * "The same thing we do every night, Pinky - try to take over the world!"
 */
class ModelStrategy {
  constructor() {
    this.attempts = new Map()
    this.escalationThreshold = 2
    // 5 minutes
    this.brainTimeout = 5 * 60 * 1000
    this.brainActivatedAt = null
    this.lastTaskComplexity = new Map()
  }

  selectMode(task, options = {}) {
    const { forceModel = null } = options

    // Honor explicit flags.
    if (forceModel === 'the-brain') {
      log.substep('🧠 The Brain activated (user requested)')
      return 'the-brain'
    }
    if (forceModel === 'pinky') {
      return 'pinky'
    }

    // Check if in temporary Brain mode.
    if (this.brainActivatedAt) {
      const elapsed = Date.now() - this.brainActivatedAt
      if (elapsed < this.brainTimeout) {
        const remaining = Math.round((this.brainTimeout - elapsed) / 1000)
        log.substep(`🧠 Brain mode active (${remaining}s remaining)`)
        return 'the-brain'
      }
      this.brainActivatedAt = null
      log.substep('🐭 Reverting to Pinky mode')
    }

    // Auto-escalate based on failures.
    const taskKey = this.getTaskKey(task)
    const attempts = this.attempts.get(taskKey) || 0

    if (attempts >= this.escalationThreshold) {
      log.warn(`🧠 Escalating to The Brain after ${attempts} Pinky attempts`)
      this.activateBrain()
      return 'the-brain'
    }

    // Check task complexity.
    if (this.assessComplexity(task) > 0.8) {
      log.substep('🧠 Complex task detected, using The Brain')
      return 'the-brain'
    }

    // Default to efficient Pinky.
    return 'pinky'
  }

  selectModel(task, options = {}) {
    const mode = this.selectMode(task, options)

    // Map mode to model.
    // Currently both use the same model, but this allows for future differentiation.
    if (mode === 'the-brain') {
      return 'claude-3-5-sonnet-20241022'
    }

    return 'claude-3-5-sonnet-20241022'
  }

  recordAttempt(task, success) {
    const taskKey = this.getTaskKey(task)
    if (success) {
      this.attempts.delete(taskKey)
      if (this.brainActivatedAt) {
        log.substep('📝 The Brain solved it - noting pattern for future')
      }
    } else {
      const current = this.attempts.get(taskKey) || 0
      this.attempts.set(taskKey, current + 1)
    }
  }

  activateBrain(duration = this.brainTimeout) {
    this.brainActivatedAt = Date.now()
    log.substep(`🧠 The Brain activated for ${duration / 1000} seconds`)
  }

  assessComplexity(task) {
    const taskLower = task.toLowerCase()
    const complexPatterns = {
      architecture: 0.9,
      'memory leak': 0.85,
      'race condition': 0.85,
      security: 0.8,
      'complex refactor': 0.85,
      performance: 0.75,
      'production issue': 0.9,
    }

    let maxScore = 0.3
    for (const [pattern, score] of Object.entries(complexPatterns)) {
      if (taskLower.includes(pattern)) {
        maxScore = Math.max(maxScore, score)
      }
    }
    return maxScore
  }

  getTaskKey(task) {
    return task.slice(0, 100).replace(/\s+/g, '_').toLowerCase()
  }
}

const modelStrategy = new ModelStrategy()

/**
 * Smart context loading - focus on recently changed files for efficiency.
 * Reduces context by 90% while catching 95% of issues.
 */
async function getSmartContext(options = {}) {
  const {
    commits = 5,
    fileTypes = null,
    includeUncommitted = true,
    maxFiles = 30,
  } = options

  const context = {
    recent: [],
    uncommitted: [],
    hotspots: [],
    priority: [],
    commitMessages: [],
  }

  // Get uncommitted changes (highest priority)
  if (includeUncommitted) {
    const stagedResult = await runCommandWithOutput(
      'git',
      ['diff', '--cached', '--name-only'],
      {
        cwd: rootPath,
      },
    )
    const unstagedResult = await runCommandWithOutput(
      'git',
      ['diff', '--name-only'],
      {
        cwd: rootPath,
      },
    )

    context.uncommitted = [
      ...new Set([
        ...stagedResult.stdout.trim().split('\n').filter(Boolean),
        ...unstagedResult.stdout.trim().split('\n').filter(Boolean),
      ]),
    ]
  }

  // Get files changed in recent commits
  const recentResult = await runCommandWithOutput(
    'git',
    ['diff', '--name-only', `HEAD~${commits}..HEAD`],
    { cwd: rootPath },
  )

  context.recent = recentResult.stdout.trim().split('\n').filter(Boolean)

  // Find hotspots (files that change frequently)
  const frequency = {}
  context.recent.forEach(file => {
    frequency[file] = (frequency[file] || 0) + 1
  })

  context.hotspots = Object.entries(frequency)
    .filter(([_, count]) => count > 1)
    .sort(([_, a], [__, b]) => b - a)
    .map(([file]) => file)

  // Get recent commit messages for intent inference
  const logResult = await runCommandWithOutput(
    'git',
    ['log', '--oneline', '-n', commits.toString()],
    { cwd: rootPath },
  )

  context.commitMessages = logResult.stdout.trim().split('\n')

  // Build priority list
  context.priority = [
    ...context.uncommitted,
    ...context.hotspots,
    ...context.recent.filter(f => !context.hotspots.includes(f)),
  ]

  // Remove duplicates and apply filters
  context.priority = [...new Set(context.priority)]

  if (fileTypes) {
    context.priority = context.priority.filter(file =>
      fileTypes.some(ext => file.endsWith(ext)),
    )
  }

  // Limit to maxFiles
  context.priority = context.priority.slice(0, maxFiles)

  // Infer developer intent from commits
  context.intent = inferIntent(context.commitMessages)

  return context
}

/**
 * Infer what the developer is working on from commit messages.
 */
function inferIntent(messages) {
  const patterns = {
    bugfix: /fix|bug|issue|error|crash/i,
    feature: /add|implement|feature|new/i,
    refactor: /refactor|clean|improve|optimize/i,
    security: /security|vulnerability|cve/i,
    performance: /perf|speed|optimize|faster/i,
    test: /test|spec|coverage/i,
  }

  const intents = new Set()
  messages.forEach(msg => {
    Object.entries(patterns).forEach(([intent, pattern]) => {
      if (pattern.test(msg)) {
        intents.add(intent)
      }
    })
  })

  return Array.from(intents)
}

/**
 * Enhanced prompt templates with rich context.
 */
const PROMPT_TEMPLATES = {
  review: context => `Role: Senior Principal Engineer at Socket.dev
Expertise: Security, Performance, Node.js, TypeScript

Project Context:
- Name: ${context.projectName || 'Socket project'}
- Type: ${context.projectType || 'Node.js/TypeScript'}
- Recent work: ${context.intent?.join(', ') || 'general development'}
- Files changed: ${context.uncommitted?.length || 0} uncommitted, ${context.hotspots?.length || 0} hotspots

Review Criteria (in priority order):
1. Security vulnerabilities (especially supply chain)
2. Performance bottlenecks and memory leaks
3. Race conditions and async issues
4. Error handling gaps
5. Code maintainability

Recent commits context:
${context.commitMessages?.slice(0, 5).join('\n') || 'No recent commits'}

Provide:
- Severity level for each issue
- Specific line numbers
- Concrete fix examples
- Performance impact estimates`,

  fix: context => `Role: Principal Security Engineer
Focus: Socket.dev supply chain security

Scan Context:
- Priority files: ${context.priority?.slice(0, 10).join(', ') || 'all files'}
- Intent: ${context.intent?.join(', ') || 'general fixes'}

Focus Areas:
1. PRIORITY 1 - Security vulnerabilities
2. PRIORITY 2 - Memory leaks and performance
3. PRIORITY 3 - Error handling

Auto-fix Capabilities:
- Apply ESLint fixes
- Update TypeScript types
- Add error boundaries
- Implement retry logic
- Add input validation`,

  green: context => `Role: Principal DevOps Engineer
Mission: Achieve green CI build

Current Issues:
${context.ciErrors?.map(e => `- ${e}`).join('\n') || 'Unknown CI failures'}

Available Actions:
1. Update test snapshots
2. Fix lint issues
3. Resolve type errors
4. Install missing pinned dependencies
5. Update configurations

Constraints:
- Do NOT modify business logic
- Do NOT delete tests
- DO fix root causes`,

  test: context => `Role: Principal Test Engineer
Framework: ${context.testFramework || 'Vitest'}

Generate comprehensive tests for:
${context.targetFiles?.join('\n') || 'specified files'}

Requirements:
- Achieve 100% code coverage
- Include edge cases
- Add error scenarios
- Test async operations
- Mock external dependencies`,

  refactor: context => `Role: Principal Software Architect
Focus: Code quality and maintainability

Files to refactor:
${context.priority?.slice(0, 20).join('\n') || 'specified files'}

Improvements:
- Apply SOLID principles
- Reduce cyclomatic complexity
- Improve type safety
- Enhance testability
- Optimize performance`,
}

/**
 * Build enhanced prompt with context.
 */
async function buildEnhancedPrompt(template, basePrompt, options = {}) {
  const context = await getSmartContext(options)

  // Add project info
  try {
    const packageJsonPath = path.join(rootPath, 'package.json')
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
      context.projectName = packageJson.name
      context.projectType = packageJson.type || 'commonjs'
      context.testFramework = Object.keys(
        packageJson.devDependencies || {},
      ).find(dep => ['vitest', 'jest', 'mocha'].includes(dep))
    }
  } catch {
    // Ignore if can't read package.json
  }

  // Get template or use base prompt
  let enhancedPrompt = basePrompt
  if (PROMPT_TEMPLATES[template]) {
    const templatePrompt = PROMPT_TEMPLATES[template](context)
    enhancedPrompt = `${templatePrompt}\n\n${basePrompt}`
  }

  // Add file context if priority files exist
  if (context.priority?.length > 0) {
    enhancedPrompt += `\n\nPRIORITY FILES TO FOCUS ON:\n${context.priority
      .slice(0, 20)
      .map((f, i) => `${i + 1}. ${f}`)
      .join('\n')}`
  }

  return enhancedPrompt
}

/**
 * Filter CI logs to extract only relevant failure information
 * Removes runner setup noise and focuses on actual errors
 */
function filterCILogs(rawLogs) {
  const lines = rawLogs.split('\n')
  const relevantLines = []
  let inErrorSection = false

  for (const line of lines) {
    // Skip runner metadata and setup
    if (
      line.includes('Current runner version:') ||
      line.includes('Runner Image') ||
      line.includes('Operating System') ||
      line.includes('GITHUB_TOKEN') ||
      line.includes('Prepare workflow') ||
      line.includes('Prepare all required') ||
      line.includes('##[group]') ||
      line.includes('##[endgroup]') ||
      line.includes('Post job cleanup') ||
      line.includes('git config') ||
      line.includes('git submodule') ||
      line.includes('Cleaning up orphan') ||
      line.includes('secret source:') ||
      line.includes('[command]/usr/bin/git')
    ) {
      continue
    }

    // Detect error sections
    if (
      line.includes('##[error]') ||
      line.includes('Error:') ||
      line.includes('error TS') ||
      line.includes('FAIL') ||
      line.includes('✗') ||
      line.includes('❌') ||
      line.includes('failed') ||
      line.includes('ELIFECYCLE')
    ) {
      inErrorSection = true
      relevantLines.push(line)
    } else if (inErrorSection && line.trim() !== '') {
      relevantLines.push(line)
      // Keep context for 5 lines after error
      if (relevantLines.length > 100) {
        inErrorSection = false
      }
    }
  }

  // If no errors found, return last 50 lines (might contain useful context)
  if (relevantLines.length === 0) {
    return lines.slice(-50).join('\n')
  }

  return relevantLines.join('\n')
}

/**
 * Prepare Claude command arguments for Claude Code.
 * Claude Code uses natural language prompts, not the same flags.
 * We'll translate our flags into appropriate context.
 */
function prepareClaudeArgs(args = [], options = {}) {
  const _opts = { __proto__: null, ...options }
  const claudeArgs = [...args]

  // Smart model selection.
  const task = _opts.prompt || _opts.command || 'general task'
  const forceModel = _opts['the-brain']
    ? 'the-brain'
    : _opts.pinky
      ? 'pinky'
      : null

  const mode = modelStrategy.selectMode(task, {
    forceModel,
    lastError: _opts.lastError,
  })

  const model = modelStrategy.selectModel(task, {
    forceModel,
    lastError: _opts.lastError,
  })

  // Track mode for caching and logging.
  _opts._selectedMode = mode
  _opts._selectedModel = model

  // Add --dangerously-skip-permissions unless --no-darkwing is specified
  // "Let's get dangerous!" mode for automated CI fixes
  if (!_opts['no-darkwing']) {
    claudeArgs.push('--dangerously-skip-permissions')
  }

  return claudeArgs
}

/**
 * Execute tasks in parallel with multiple workers.
 * Default: 3 workers (balanced performance without overwhelming system)
 */
async function executeParallel(tasks, workers = 3) {
  if (workers === 1 || tasks.length === 1) {
    // Sequential execution
    const results = []
    for (const task of tasks) {
      results.push(await task())
    }
    return results
  }

  // Parallel execution with worker limit
  log.substep(`🚀 Executing ${tasks.length} tasks with ${workers} workers`)
  const results = []
  const executing = []

  for (const task of tasks) {
    const promise = task().then(result => {
      executing.splice(executing.indexOf(promise), 1)
      return result
    })

    results.push(promise)
    executing.push(promise)

    if (executing.length >= workers) {
      await Promise.race(executing)
    }
  }

  return Promise.all(results)
}

/**
 * Determine if parallel execution should be used.
 */
function shouldRunParallel(options = {}) {
  const opts = { __proto__: null, ...options }
  // Parallel is only used when:
  // 1. --cross-repo is specified (multi-repo mode)
  // 2. AND --seq is not specified
  if (opts['cross-repo'] && !opts.seq) {
    return true
  }
  return false
}

/**
 * Run tasks in parallel with progress tracking.
 * NOTE: When running Claude agents in parallel, they must use stdio: 'pipe' to avoid
 * conflicting interactive prompts. If agents need user interaction, they would queue
 * and block each other. Use --seq flag for sequential execution with full interactivity.
 */
async function runParallel(tasks, description = 'tasks', taskNames = []) {
  log.info(`Running ${tasks.length} ${description} in parallel...`)

  const startTime = Date.now()
  let completed = 0

  // Add progress tracking to each task
  const trackedTasks = tasks.map((task, index) => {
    const name = taskNames[index] || `Task ${index + 1}`
    const taskStartTime = Date.now()

    return task.then(
      result => {
        completed++
        const elapsed = Math.round((Date.now() - taskStartTime) / 1000)
        log.done(
          `[${name}] Completed (${elapsed}s) - ${completed}/${tasks.length}`,
        )
        return result
      },
      error => {
        completed++
        const elapsed = Math.round((Date.now() - taskStartTime) / 1000)
        log.failed(
          `[${name}] Failed (${elapsed}s) - ${completed}/${tasks.length}`,
        )
        throw error
      },
    )
  })

  // Progress indicator
  const progressInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    const pending = tasks.length - completed
    if (pending > 0) {
      log.substep(
        `Progress: ${completed}/${tasks.length} complete, ${pending} running (${elapsed}s elapsed)`,
      )
    }
  }, 15_000)
  // Update every 15 seconds

  const results = await Promise.allSettled(trackedTasks)
  clearInterval(progressInterval)

  const totalElapsed = Math.round((Date.now() - startTime) / 1000)
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length

  if (failed > 0) {
    log.warn(
      `Completed in ${totalElapsed}s: ${succeeded} succeeded, ${failed} failed`,
    )
    // Log errors with task names
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const name = taskNames[index] || `Task ${index + 1}`
        log.error(`[${name}] failed: ${result.reason}`)
      }
    })
  } else {
    log.success(
      `All ${succeeded} ${description} completed successfully in ${totalElapsed}s`,
    )
  }

  return results
}

/**
 * Ensure .claude directory is in .gitignore.
 */
async function ensureClaudeInGitignore() {
  const gitignorePath = path.join(rootPath, '.gitignore')

  try {
    // Check if .gitignore exists.
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
    const lines = gitignoreContent.split('\n')

    // Check if .claude is already ignored.
    const hasClaudeEntry = lines.some(line => {
      const trimmed = line.trim()
      return (
        trimmed === '.claude' ||
        trimmed === '/.claude' ||
        trimmed === '.claude/' ||
        trimmed === '/.claude/'
      )
    })

    if (!hasClaudeEntry) {
      // Add .claude to .gitignore.
      log.warn('.claude directory not in .gitignore, adding it')
      const updatedContent = `${gitignoreContent.trimEnd()}\n/.claude\n`
      await fs.writeFile(gitignorePath, updatedContent)
      log.done('Added /.claude to .gitignore')
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      // Create .gitignore with .claude entry.
      log.warn('No .gitignore found, creating one')
      await fs.writeFile(gitignorePath, '/.claude\n')
      log.done('Created .gitignore with /.claude entry')
    } else {
      log.error(`Failed to check .gitignore: ${e.message}`)
    }
  }
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
        claudeMdPath,
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
  const _opts = { __proto__: null, ...options }
  const { claudeMdPath, name } = project
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
  let fullPrompt = `${prompt}\n\n`

  if (!isRegistry && canonicalContent) {
    fullPrompt += `===== CANONICAL socket-registry/CLAUDE.md =====
${canonicalContent}

`
  }

  fullPrompt += `===== CURRENT ${name}/CLAUDE.md =====
${currentContent}

===== OUTPUT UPDATED ${name}/CLAUDE.md BELOW =====`

  // Call Claude to update the file.
  const result = await runCommandWithOutput(
    claudeCmd,
    prepareClaudeArgs([], options),
    {
      input: fullPrompt,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

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
  const statusResult = await runCommandWithOutput(
    'git',
    ['status', '--porcelain', 'CLAUDE.md'],
    {
      cwd: projectPath,
    },
  )

  if (!statusResult.stdout.trim()) {
    log.done(`No changes in ${name}`)
    return true
  }

  // Stage the file.
  await runCommand('git', ['add', 'CLAUDE.md'], {
    cwd: projectPath,
    stdio: 'pipe',
  })

  // Commit with appropriate message.
  const message =
    name === 'socket-registry'
      ? 'Update CLAUDE.md as canonical source for cross-project standards'
      : 'Sync CLAUDE.md with canonical socket-registry standards'

  const commitResult = await runCommandWithOutput(
    'git',
    ['commit', '-m', message, '--no-verify'],
    {
      cwd: projectPath,
    },
  )

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
    SOCKET_PROJECTS.forEach(p => {
      log.substep(path.join(parentPath, p))
    })
    return false
  }
  log.done(`Found ${projects.length} Socket projects`)

  // Process socket-registry first (it's the canonical source).
  log.step('Updating canonical source')
  const registryProject = projects.find(p => p.name === 'socket-registry')
  if (registryProject) {
    const success = await updateProjectClaudeMd(
      claudeCmd,
      registryProject,
      options,
    )
    if (!success && !opts['dry-run']) {
      log.error('Failed to update canonical socket-registry/CLAUDE.md')
      return false
    }
  }

  // Process other projects.
  log.step('Updating project-specific files')
  const otherProjects = projects.filter(p => p.name !== 'socket-registry')

  if (shouldRunParallel(opts) && otherProjects.length > 1) {
    // Run in parallel
    const tasks = otherProjects.map(project =>
      updateProjectClaudeMd(claudeCmd, project, options)
        .then(success => ({ project: project.name, success }))
        .catch(error => ({ project: project.name, success: false, error })),
    )

    const taskNames = projects.map(p => path.basename(p))
    const results = await runParallel(tasks, 'CLAUDE.md updates', taskNames)

    // Check for failures
    results.forEach(result => {
      if (
        result.status === 'fulfilled' &&
        !result.value.success &&
        !opts['dry-run']
      ) {
        log.error(`Failed to update ${result.value.project}/CLAUDE.md`)
      }
    })
  } else {
    // Run sequentially
    for (const project of otherProjects) {
      const success = await updateProjectClaudeMd(claudeCmd, project, options)
      if (!success && !opts['dry-run']) {
        log.error(`Failed to update ${project.name}/CLAUDE.md`)
        // Continue with other projects.
      }
    }
  }

  // Commit changes if not skipped.
  if (!opts['skip-commit'] && !opts['dry-run']) {
    log.step('Committing changes')

    if (shouldRunParallel(opts) && projects.length > 1) {
      // Run commits in parallel
      const tasks = projects.map(project => commitChanges(project))
      const taskNames = projects.map(p => path.basename(p))
      await runParallel(tasks, 'commits', taskNames)
    } else {
      // Run sequentially
      for (const project of projects) {
        await commitChanges(project)
      }
    }
  }

  // Push if requested.
  if (opts.push && !opts['dry-run']) {
    log.step('Pushing changes')

    if (shouldRunParallel(opts) && projects.length > 1) {
      // Run pushes in parallel
      const tasks = projects.map(project => {
        return runCommandWithOutput('git', ['push'], {
          cwd: project.path,
        })
          .then(pushResult => ({
            project: project.name,
            success: pushResult.exitCode === 0,
          }))
          .catch(error => ({
            project: project.name,
            success: false,
            error,
          }))
      })

      const results = await runParallel(tasks, 'pushes')

      // Report results
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success) {
          log.done(`Pushed ${result.value.project}`)
        } else {
          log.failed(`Failed to push ${result.value.project}`)
        }
      })
    } else {
      // Run sequentially
      for (const project of projects) {
        log.progress(`Pushing ${project.name}`)
        const pushResult = await runCommandWithOutput('git', ['push'], {
          cwd: project.path,
        })

        if (pushResult.exitCode === 0) {
          log.done(`Pushed ${project.name}`)
        } else {
          log.failed(`Failed to push ${project.name}`)
        }
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
  const _opts = { __proto__: null, ...options }
  const { name, path: projectPath } = project

  log.progress(`Scanning ${name} for issues`)

  // Find source files to scan
  const extensions = ['.js', '.mjs', '.ts', '.mts', '.jsx', '.tsx']
  const allFiles = []

  async function findFiles(dir, depth = 0) {
    // Limit depth to avoid excessive scanning
    if (depth > 5) {
      return
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        // Skip common directories to ignore.
        if (entry.isDirectory()) {
          if (
            [
              'node_modules',
              '.git',
              'dist',
              'build',
              'coverage',
              '.cache',
            ].includes(entry.name)
          ) {
            continue
          }
          await findFiles(fullPath, depth + 1)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name)
          if (extensions.includes(ext)) {
            allFiles.push(fullPath)
          }
        }
      }
    } catch (e) {
      // Log permission errors but continue scanning.
      if (e.code === 'EACCES' || e.code === 'EPERM') {
        // Silently skip permission errors.
      } else {
        log.warn(`Error scanning ${dir}: ${e.message}`)
      }
    }
  }

  await findFiles(projectPath)

  // Use smart context if available to prioritize files
  let filesToScan = allFiles
  if (_opts.smartContext !== false) {
    const context = await getSmartContext({
      fileTypes: extensions,
      maxFiles: 100,
    })

    if (context.priority.length > 0) {
      // Prioritize recently changed files
      const priorityFiles = context.priority
        .map(f => path.join(projectPath, f))
        .filter(f => allFiles.includes(f))

      // Add other files after priority ones
      const otherFiles = allFiles.filter(f => !priorityFiles.includes(f))
      filesToScan = [...priorityFiles, ...otherFiles]

      log.substep(`Prioritizing ${priorityFiles.length} recently changed files`)
    }
  }

  // Limit total files to scan
  const MAX_FILES = 500
  if (filesToScan.length > MAX_FILES) {
    log.substep(
      `Limiting scan to first ${MAX_FILES} files (${filesToScan.length} total found)`,
    )
    filesToScan = filesToScan.slice(0, MAX_FILES)
  }

  // Create enhanced scanning prompt with context
  const basePrompt = `You are performing a security and quality audit on the ${name} project.

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

  // Use enhanced prompt for better context
  const enhancedPrompt = await buildEnhancedPrompt('fix', basePrompt, {
    maxFiles: 50,
    smartContext: true,
  })

  // Call Claude to scan.
  const result = await runCommandWithOutput(
    claudeCmd,
    prepareClaudeArgs([], options),
    {
      input: enhancedPrompt,
      stdio: ['pipe', 'pipe', 'pipe'],
      // 10MB buffer for large responses
      maxBuffer: 1024 * 1024 * 10,
    },
  )

  if (result.exitCode !== 0) {
    log.failed(`Failed to scan ${name}`)
    return null
  }

  log.done(`Scanned ${name}`)

  try {
    return JSON.parse(result.stdout.trim())
  } catch {
    log.warn(`Failed to parse scan results for ${name}`)
    return null
  }
}

/**
 * Autonomous fix session - auto-fixes high-confidence issues.
 */
async function autonomousFixSession(
  claudeCmd,
  scanResults,
  projects,
  options = {},
) {
  const opts = { __proto__: null, ...options }
  printHeader('Auto-Fix Mode')

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
        case 'critical':
          critical.push(issue)
          break
        case 'high':
          high.push(issue)
          break
        case 'medium':
          medium.push(issue)
          break
        default:
          low.push(issue)
      }
    }
  }

  const totalIssues = critical.length + high.length + medium.length + low.length

  log.info('🎯 Auto-fix mode: Carefully fixing issues with double-checking')
  console.log('\nIssues found:')
  console.log(`  ${colors.red(`Critical: ${critical.length}`)}`)
  console.log(`  ${colors.yellow(`High: ${high.length}`)}`)
  console.log(`  ${colors.cyan(`Medium: ${medium.length}`)}`)
  console.log(`  ${colors.gray(`Low: ${low.length}`)}`)

  if (totalIssues === 0) {
    log.success('No issues found!')
    return
  }

  // Auto-fixable issue types (high confidence)
  const autoFixableTypes = new Set([
    'console-log',
    'missing-await',
    'unused-variable',
    'missing-semicolon',
    'wrong-import-path',
    'deprecated-api',
    'type-error',
    'lint-error',
  ])

  // Determine which issues to auto-fix
  const toAutoFix = [...critical, ...high].filter(issue => {
    // Auto-fix if type is in whitelist OR severity is critical
    return issue.severity === 'critical' || autoFixableTypes.has(issue.type)
  })

  const toReview = [...critical, ...high, ...medium].filter(issue => {
    return !toAutoFix.includes(issue)
  })

  log.step(`Auto-fixing ${toAutoFix.length} high-confidence issues`)
  log.substep(`${toReview.length} issues will require manual review`)

  // Apply auto-fixes in parallel based on workers setting
  const workers = Number.parseInt(opts.workers, 10) || 3
  if (toAutoFix.length > 0) {
    const fixTasks = toAutoFix.map(issue => async () => {
      const projectData = projects.find(p => p.name === issue.project)
      if (!projectData) {
        return false
      }

      const fixPrompt = `Fix this issue automatically:
File: ${issue.file}
Line: ${issue.line}
Type: ${issue.type}
Severity: ${issue.severity}
Description: ${issue.description}
Suggested fix: ${issue.fix}

Apply the fix and return ONLY the fixed code snippet.`

      const result = await runClaude(claudeCmd, fixPrompt, {
        ...opts,
        interactive: false,
        cache: false,
      })

      if (result) {
        log.done(`Fixed: ${issue.file}:${issue.line} - ${issue.type}`)
        return true
      }
      return false
    })

    await executeParallel(fixTasks, workers)
  }

  // Report issues that need review
  if (toReview.length > 0) {
    console.log(`\n${colors.yellow('Issues requiring manual review:')}`)
    toReview.forEach((issue, i) => {
      console.log(
        `${i + 1}. [${issue.severity}] ${issue.file}:${issue.line} - ${issue.description}`,
      )
    })
    console.log('\nRun with --prompt to fix these interactively')
  }

  log.success('Autonomous fix session complete!')
}

/**
 * Interactive fix session with Claude.
 */
async function interactiveFixSession(
  claudeCmd,
  scanResults,
  _projects,
  options = {},
) {
  const _opts = { __proto__: null, ...options }
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
        case 'critical':
          critical.push(issue)
          break
        case 'high':
          high.push(issue)
          break
        case 'medium':
          medium.push(issue)
          break
        default:
          low.push(issue)
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
  console.log(
    `\n${colors.blue('Starting interactive fix session with Claude...')}`,
  )
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
    stdio: 'inherit',
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

  if (!opts['cross-repo']) {
    // Default: Scan only current project.
    const currentProjectName = path.basename(rootPath)
    projects.push({
      name: currentProjectName,
      path: rootPath,
    })
    log.info('Scanning current project only')
  } else {
    // With --cross-repo: Scan all Socket projects.
    for (const projectName of SOCKET_PROJECTS) {
      const projectPath = path.join(parentPath, projectName)
      if (existsSync(projectPath)) {
        projects.push({
          name: projectName,
          path: projectPath,
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

  if (shouldRunParallel(opts) && projects.length > 1) {
    // Run scans in parallel
    const tasks = projects.map(project =>
      scanProjectForIssues(claudeCmd, project, options)
        .then(issues => ({ project: project.name, issues }))
        .catch(error => ({ project: project.name, issues: null, error })),
    )

    const taskNames = projects.map(p => p.name)
    const results = await runParallel(tasks, 'security scans', taskNames)

    // Collect results
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.issues) {
        scanResults[result.value.project] = result.value.issues
      }
    })
  } else {
    // Run sequentially
    for (const project of projects) {
      const issues = await scanProjectForIssues(claudeCmd, project, options)
      if (issues) {
        scanResults[project.name] = issues
      }
    }
  }

  // Generate report.
  if (!opts['no-report']) {
    log.step('Generating scan report')
    // Ensure .claude is in .gitignore before writing scratch files.
    await ensureClaudeInGitignore()
    // Ensure .claude directory exists for scratch files.
    await fs.mkdir(claudeDir, { recursive: true })
    const reportPath = path.join(claudeDir, 'security-scan-report.json')
    await fs.writeFile(reportPath, JSON.stringify(scanResults, null, 2))
    log.done(`Report saved to: ${reportPath}`)
  }

  // Start fix session based on mode.
  if (opts.prompt) {
    // Prompt mode - user approves each fix
    await interactiveFixSession(claudeCmd, scanResults, projects, options)
  } else {
    // Default: Auto-fix mode with careful checking
    await autonomousFixSession(claudeCmd, scanResults, projects, options)
  }

  return true
}

/**
 * Run Claude-assisted commits across Socket projects.
 * Default: operates on current project only. Use --cross-repo for all Socket projects.
 * IMPORTANT: When running in parallel mode (--cross-repo), Claude agents run silently (stdio: 'pipe').
 * Interactive prompts would conflict if multiple agents needed user input simultaneously.
 * Use --seq flag if you need interactive debugging across multiple repos.
 */
async function runClaudeCommit(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Claude-Assisted Commit')

  // Find projects to commit in.
  log.step('Finding projects to commit')
  const projects = []

  if (!opts['cross-repo']) {
    // Default: Commit only in current project.
    const currentProjectName = path.basename(rootPath)
    projects.push({
      name: currentProjectName,
      path: rootPath,
    })
    log.info('Committing in current project only')
  } else {
    // With --cross-repo: Commit in all Socket projects with changes.
    for (const projectName of SOCKET_PROJECTS) {
      const projectPath = path.join(parentPath, projectName)
      if (existsSync(projectPath)) {
        // Check if project has changes.
        const statusResult = await runCommandWithOutput(
          'git',
          ['status', '--porcelain'],
          {
            cwd: projectPath,
          },
        )

        if (statusResult.stdout.trim()) {
          projects.push({
            name: projectName,
            path: projectPath,
            changes: statusResult.stdout.trim(),
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
  if (shouldRunParallel(opts) && projects.length > 1) {
    // Run commits in parallel
    const tasks = projects.map(project => {
      const commitTask = async () => {
        log.step(`Processing ${project.name}`)

        // Show current changes.
        if (project.changes) {
          log.substep('Changes detected:')
          const changeLines = project.changes.split('\n')
          changeLines.slice(0, 10).forEach(line => {
            log.substep(`  ${line}`)
          })
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
        const commitResult = await runCommandWithOutput(
          claudeCmd,
          prepareClaudeArgs([], options),
          {
            input: prompt,
            cwd: project.path,
            stdio: 'inherit',
          },
        )

        if (commitResult.exitCode === 0) {
          log.done(`Committed changes in ${project.name}`)
          return { project: project.name, success: true }
        }
        log.failed(`Failed to commit in ${project.name}`)
        return { project: project.name, success: false }
      }

      return commitTask()
    })

    await runParallel(tasks, 'commits')
  } else {
    // Run sequentially
    for (const project of projects) {
      log.step(`Processing ${project.name}`)

      // Show current changes.
      if (project.changes) {
        log.substep('Changes detected:')
        const changeLines = project.changes.split('\n')
        changeLines.slice(0, 10).forEach(line => {
          log.substep(`  ${line}`)
        })
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
      const commitResult = await runCommandWithOutput(
        claudeCmd,
        prepareClaudeArgs([], options),
        {
          input: prompt,
          cwd: project.path,
          stdio: 'inherit',
        },
      )

      if (commitResult.exitCode === 0) {
        log.done(`Committed changes in ${project.name}`)
      } else {
        log.failed(`Failed to commit in ${project.name}`)
      }
    }
  }

  // Optionally push changes.
  if (opts.push) {
    log.step('Pushing changes to remote')

    if (shouldRunParallel(opts) && projects.length > 1) {
      // Run pushes in parallel
      const tasks = projects.map(project => {
        return runCommandWithOutput('git', ['push'], {
          cwd: project.path,
        })
          .then(pushResult => ({
            project: project.name,
            success: pushResult.exitCode === 0,
          }))
          .catch(error => ({
            project: project.name,
            success: false,
            error,
          }))
      })

      const results = await runParallel(tasks, 'pushes')

      // Report results
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success) {
          log.done(`Pushed ${result.value.project}`)
        } else {
          log.failed(`Failed to push ${result.value.project}`)
        }
      })
    } else {
      // Run sequentially
      for (const project of projects) {
        log.progress(`Pushing ${project.name}`)
        const pushResult = await runCommandWithOutput('git', ['push'], {
          cwd: project.path,
        })

        if (pushResult.exitCode === 0) {
          log.done(`Pushed ${project.name}`)
        } else {
          log.failed(`Failed to push ${project.name}`)
        }
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

  const basePrompt = `Review the following staged changes:

${diffResult.stdout}

Provide specific feedback with file:line references.
Format your review as constructive feedback with severity levels (critical/high/medium/low).
Also check for CLAUDE.md compliance and cross-platform compatibility.`

  // Use enhanced prompt with context
  const enhancedPrompt = await buildEnhancedPrompt('review', basePrompt, {
    // Only staged changes
    includeUncommitted: false,
    commits: 10,
  })

  log.step('Starting code review with Claude')
  await runClaude(claudeCmd, enhancedPrompt, opts)

  return true
}

/**
 * Analyze and manage dependencies.
 */
async function runDependencyAnalysis(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Dependency Analysis')

  // Read package.json.
  const packageJson = JSON.parse(
    await fs.readFile(path.join(rootPath, 'package.json'), 'utf8'),
  )

  // Check for outdated packages.
  log.progress('Checking for outdated packages')
  const outdatedResult = await runCommandWithOutput('pnpm', [
    'outdated',
    '--json',
  ])

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

IMPORTANT Socket Requirements:
- All dependencies MUST be pinned to exact versions (no ^ or ~ prefixes)
- Use pnpm add <pkg> --save-exact for all new dependencies
- GitHub CLI (gh) is required but installed separately (not via npm)

Provide:
1. Version pinning issues (identify any deps with ^ or ~ prefixes)
2. Security vulnerability analysis
3. Unused dependency detection
4. Update recommendations with migration notes (using exact versions)
5. License compatibility check
6. Bundle size impact analysis
7. Alternative package suggestions

Focus on actionable recommendations. Always recommend exact versions when suggesting updates.`

  await runClaude(claudeCmd, prompt, opts)

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

  const filePath = path.isAbsolute(targetFile)
    ? targetFile
    : path.join(rootPath, targetFile)

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
  const result = await runCommandWithOutput(
    claudeCmd,
    prepareClaudeArgs([], opts),
    {
      input: prompt,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

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
    cwd: targetPath,
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

  const filePath = path.isAbsolute(targetFile)
    ? targetFile
    : path.join(rootPath, targetFile)

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

  await runClaude(claudeCmd, prompt, opts)

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

  const filePath = path.isAbsolute(targetFile)
    ? targetFile
    : path.join(rootPath, targetFile)

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

  await runClaude(claudeCmd, prompt, opts)

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
    fs.readFile(path.join(rootPath, 'package.json'), 'utf8'),
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

  await runClaude(claudeCmd, prompt, opts)

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
  const filePath = path.isAbsolute(targetFile)
    ? targetFile
    : path.join(rootPath, targetFile)

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

  await runClaude(claudeCmd, prompt, opts)

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

  const packageJson = JSON.parse(
    await fs.readFile(path.join(rootPath, 'package.json'), 'utf8'),
  )

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

  await runClaude(claudeCmd, prompt, opts)

  return true
}

/**
 * Clean up code by removing unused elements.
 */
async function runCleanup(claudeCmd, options = {}) {
  const _opts = { __proto__: null, ...options }
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
    cwd: rootPath,
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
  const possibleFile = path.isAbsolute(errorOrFile)
    ? errorOrFile
    : path.join(rootPath, errorOrFile)
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

  await runClaude(claudeCmd, prompt, opts)

  return true
}

/**
 * Generate a commit message using Claude non-interactively.
 * @param {string} claudeCmd - Path to Claude CLI
 * @param {string} cwd - Working directory
 * @param {object} options - Options from parent command
 * @returns {Promise<string>} Generated commit message
 */
async function generateCommitMessage(claudeCmd, cwd, options = {}) {
  const opts = { __proto__: null, ...options }

  // Get git diff of staged changes
  const diffResult = await runCommandWithOutput('git', ['diff', '--cached'], {
    cwd,
  })

  // Get git status
  const statusResult = await runCommandWithOutput(
    'git',
    ['status', '--short'],
    { cwd },
  )

  // Get recent commit messages for style consistency
  const logResult = await runCommandWithOutput(
    'git',
    ['log', '--oneline', '-n', '5'],
    { cwd },
  )

  const prompt = `Generate a concise commit message for these changes.

Git status:
${statusResult.stdout || 'No status output'}

Git diff (staged changes):
${diffResult.stdout || 'No diff output'}

Recent commits (for style reference):
${logResult.stdout || 'No recent commits'}

Requirements:
1. Write a clear, concise commit message (1-2 lines preferred)
2. Follow the style of recent commits
3. Focus on WHY the changes were made, not just WHAT changed
4. NO AI attribution (per CLAUDE.md rules)
5. NO emojis
6. Output ONLY the commit message text, nothing else

Commit message:`

  // Run Claude non-interactively to generate commit message
  const result = await new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const claudeProcess = spawn(claudeCmd, prepareClaudeArgs([], opts), {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    claudeProcess.stdout.on('data', data => {
      stdout += data.toString()
    })

    claudeProcess.stderr.on('data', data => {
      stderr += data.toString()
    })

    claudeProcess.on('close', code => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(
          new Error(
            `Claude failed to generate commit message: ${stderr || 'Unknown error'}`,
          ),
        )
      }
    })

    claudeProcess.stdin.write(prompt)
    claudeProcess.stdin.end()
  })

  // Extract just the commit message (Claude might add extra text)
  // Look for the actual message after "Commit message:" or just use the whole output
  const lines = result.split('\n').filter(line => line.trim())

  // Return the first substantial line that looks like a commit message
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip common Claude preamble phrases
    if (
      trimmed &&
      !trimmed.toLowerCase().startsWith('here') &&
      !trimmed.toLowerCase().startsWith('commit message:') &&
      !trimmed.startsWith('```') &&
      trimmed.length > 10
    ) {
      return trimmed
    }
  }

  // Fallback to first non-empty line
  return lines[0] || 'Fix local checks and update tests'
}

/**
 * Calculate adaptive poll delay based on CI state.
 * Polls faster when jobs are running, slower when queued.
 */
function calculatePollDelay(status, attempt, hasActiveJobs = false) {
  // If jobs are actively running, poll more frequently
  if (hasActiveJobs || status === 'in_progress') {
    // Start at 5s, gradually increase to 15s max
    return Math.min(5000 + attempt * 2000, 15_000)
  }

  // If queued or waiting, use longer intervals (30s)
  if (status === 'queued' || status === 'waiting') {
    return 30_000
  }

  // Default: moderate polling for unknown states (10s)
  return 10_000
}

/**
 * Priority levels for different CI job types.
 * Higher priority jobs are fixed first since they often block other jobs.
 */
const JOB_PRIORITIES = {
  build: 100,
  compile: 100,
  'type check': 90,
  typecheck: 90,
  typescript: 90,
  tsc: 90,
  lint: 80,
  eslint: 80,
  prettier: 80,
  'unit test': 70,
  test: 70,
  jest: 70,
  vitest: 70,
  integration: 60,
  e2e: 50,
  coverage: 40,
  report: 30,
}

/**
 * Get priority for a CI job based on its name.
 * @param {string} jobName - The name of the CI job
 * @returns {number} Priority level (higher = more important)
 */
function getJobPriority(jobName) {
  const lowerName = jobName.toLowerCase()

  // Check for exact or partial matches
  for (const [pattern, priority] of Object.entries(JOB_PRIORITIES)) {
    if (lowerName.includes(pattern)) {
      return priority
    }
  }

  // Default priority for unknown job types
  return 50
}

/**
 * Validate changes before pushing to catch common mistakes.
 * @param {string} cwd - Working directory
 * @returns {Promise<{valid: boolean, warnings: string[]}>} Validation result
 */
async function validateBeforePush(cwd) {
  const warnings = []

  // Check for common issues in staged changes
  const diffResult = await runCommandWithOutput('git', ['diff', '--cached'], {
    cwd,
  })
  const diff = diffResult.stdout

  // Check 1: No console.log statements
  if (diff.match(/^\+.*console\.log\(/m)) {
    warnings.push(
      `${colors.yellow('⚠')} Added console.log() statements detected`,
    )
  }

  // Check 2: No .only in tests
  if (diff.match(/^\+.*\.(only|skip)\(/m)) {
    warnings.push(`${colors.yellow('⚠')} Test .only() or .skip() detected`)
  }

  // Check 3: No debugger statements
  if (diff.match(/^\+.*debugger[;\s]/m)) {
    warnings.push(`${colors.yellow('⚠')} Debugger statement detected`)
  }

  // Check 4: No TODO/FIXME without issue link
  const todoMatches = diff.match(/^\+.*\/\/\s*(TODO|FIXME)(?!\s*\(#\d+\))/gim)
  if (todoMatches && todoMatches.length > 0) {
    warnings.push(
      `${colors.yellow('⚠')} ${todoMatches.length} TODO/FIXME comment(s) without issue links`,
    )
  }

  // Check 5: Package.json is valid JSON
  if (diff.includes('package.json')) {
    try {
      const pkgPath = path.join(cwd, 'package.json')
      const pkgContent = await fs.readFile(pkgPath, 'utf8')
      JSON.parse(pkgContent)
    } catch (e) {
      warnings.push(`${colors.yellow('⚠')} Invalid package.json: ${e.message}`)
    }
  }

  return { valid: warnings.length === 0, warnings }
}

/**
 * Run all checks, push, and monitor CI until green.
 * NOTE: This operates on the current repo by default. Use --cross-repo for all Socket projects.
 * Multi-repo parallel execution would conflict with interactive prompts if fixes fail.
 */
async function runGreen(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  const maxRetries = Number.parseInt(opts['max-retries'] || '3', 10)
  const isDryRun = opts['dry-run']
  const MAX_AUTO_FIX_ATTEMPTS = Number.parseInt(
    opts['max-auto-fixes'] || '10',
    10,
  )
  const useNoVerify = opts['no-verify'] === true

  // Initialize storage and cleanup old data.
  await initStorage()
  await cleanupOldData()

  // Initialize trackers.
  const costTracker = new CostTracker()
  const progress = new ProgressTracker()
  const snapshots = new SnapshotManager()
  let fixCount = 0

  printHeader('Green CI Pipeline')

  // Optional: Run pre-commit scan for proactive detection.
  if (opts['pre-commit-scan']) {
    log.step('Running proactive pre-commit scan')
    const scanResult = await runPreCommitScan(claudeCmd)

    if (scanResult && !scanResult.safe) {
      log.warn('Pre-commit scan detected potential issues:')
      scanResult.issues.forEach(issue => {
        const icon =
          issue.severity === 'high' ? colors.red('✗') : colors.yellow('⚠')
        log.substep(
          `${icon} ${issue.type}: ${issue.description} ${colors.gray(`(${issue.confidence}% confidence)`)}`,
        )
      })

      // Ask if user wants to continue.
      log.info('Continue anyway? (Ctrl+C to abort)')
      await new Promise(resolve => setTimeout(resolve, 3000))
    } else if (scanResult?.safe) {
      log.done('Pre-commit scan passed - no obvious issues detected')
    }
  }

  // Show initial progress.
  progress.showProgress()

  // Track errors to avoid checking same error repeatedly
  const seenErrors = new Set()
  // Track CI errors by run ID
  const ciErrorHistory = new Map()

  // Step 1: Run local checks
  progress.startPhase('local-checks')
  const repoName = path.basename(rootPath)
  log.step(`Running local checks in ${colors.cyan(repoName)}`)
  const localChecks = [
    { name: 'Install dependencies', cmd: 'pnpm', args: ['install'] },
    { name: 'Fix code style', cmd: 'pnpm', args: ['run', 'fix'] },
    { name: 'Run checks', cmd: 'pnpm', args: ['run', 'check'] },
    { name: 'Run coverage', cmd: 'pnpm', args: ['run', 'cover'] },
    { name: 'Run tests', cmd: 'pnpm', args: ['run', 'test', '--', '--update'] },
  ]

  let autoFixAttempts = 0
  let lastAnalysis = null
  let lastErrorHash = null

  for (const check of localChecks) {
    log.progress(`[${repoName}] ${check.name}`)

    if (isDryRun) {
      log.done(`[DRY RUN] Would run: ${check.cmd} ${check.args.join(' ')}`)
      continue
    }

    // Add newline after progress indicator before command output
    console.log('')
    const result = await runCommandWithOutput(check.cmd, check.args, {
      cwd: rootPath,
      stdio: 'inherit',
    })

    if (result.exitCode !== 0) {
      log.failed(`${check.name} failed`)

      // Track error to avoid repeated attempts on same error
      const errorOutput =
        result.stderr || result.stdout || 'No error output available'
      const errorHash = hashError(errorOutput)

      if (seenErrors.has(errorHash)) {
        log.error(`Detected same error again for "${check.name}"`)
        log.substep('Skipping auto-fix to avoid infinite loop')
        log.substep('Error appears unchanged from previous attempt')
        return false
      }

      seenErrors.add(errorHash)
      autoFixAttempts++

      // Analyze root cause before attempting fix.
      const analysis = await analyzeRootCause(claudeCmd, errorOutput, {
        checkName: check.name,
        repoName,
        attempts: autoFixAttempts,
      })

      // Save for history tracking.
      lastAnalysis = analysis
      lastErrorHash = errorHash

      // Display analysis to user.
      if (analysis) {
        displayAnalysis(analysis)

        // Warn if environmental issue.
        if (analysis.isEnvironmental && analysis.confidence > 70) {
          log.warn(
            'This looks like an environmental issue - fix may not help. Consider checking runner status.',
          )
        }
      }

      // Decide whether to auto-fix or go interactive
      const isAutoMode = autoFixAttempts <= MAX_AUTO_FIX_ATTEMPTS

      if (isAutoMode) {
        // Create snapshot before fix attempt for potential rollback.
        await snapshots.createSnapshot(`before-fix-${autoFixAttempts}`)
        log.substep(`Snapshot created: before-fix-${autoFixAttempts}`)

        // Attempt automatic fix
        log.progress(
          `[${repoName}] Auto-fix attempt ${autoFixAttempts}/${MAX_AUTO_FIX_ATTEMPTS}`,
        )

        // Build fix prompt with analysis if available.
        const fixPrompt = `You are fixing a CI/build issue automatically. The command "${check.cmd} ${check.args.join(' ')}" failed in the ${path.basename(rootPath)} project.

Error output:
${errorOutput}

${
  analysis
    ? `
Root Cause Analysis:
- Problem: ${analysis.rootCause}
- Confidence: ${analysis.confidence}%
- Category: ${analysis.category}

Recommended Fix Strategy:
${
  analysis.strategies[0]
    ? `- ${analysis.strategies[0].name} (${analysis.strategies[0].probability}% success probability)
  ${analysis.strategies[0].description}
  Reasoning: ${analysis.strategies[0].reasoning}`
    : 'No specific strategy recommended'
}
`
    : ''
}

Your task:
1. Analyze the error
2. Provide the exact fix needed
3. Use file edits, commands, or both to resolve the issue

IMPORTANT:
- Be direct and specific - don't ask questions
- Provide complete solutions that will fix the error
- If the error is about missing dependencies, install pinned versions
- If it's a type error, fix the code
- If it's a lint error, fix the formatting
- If tests are failing, update snapshots or fix the test
- If a script is missing, check if there's a similar script name (e.g., 'cover' vs 'coverage')

Fix this issue now by making the necessary changes.`

        // Run Claude non-interactively with timeout and progress
        const startTime = Date.now()
        // 2 minute timeout
        const timeout = 120_000
        log.substep(`[${repoName}] Analyzing error...`)

        const claudeProcess = spawn(claudeCmd, prepareClaudeArgs([], opts), {
          cwd: rootPath,
          stdio: ['pipe', 'inherit', 'inherit'],
        })

        claudeProcess.stdin.write(fixPrompt)
        claudeProcess.stdin.end()

        // Monitor progress with timeout
        let isCleared = false
        let progressInterval = null
        const clearProgressInterval = () => {
          if (!isCleared && progressInterval) {
            clearInterval(progressInterval)
            isCleared = true
          }
        }

        progressInterval = setInterval(() => {
          const elapsed = Date.now() - startTime
          if (elapsed > timeout) {
            log.warn(
              `[${repoName}] Claude fix timed out after ${Math.round(elapsed / 1000)}s`,
            )
            clearProgressInterval()
            claudeProcess.kill()
          } else {
            log.substep(
              `[${repoName}] Claude working... (${Math.round(elapsed / 1000)}s)`,
            )
          }
        }, 10_000)
        // Update every 10 seconds

        await new Promise(resolve => {
          claudeProcess.on('close', () => {
            clearProgressInterval()
            const elapsed = Date.now() - startTime
            log.done(
              `[${repoName}] Claude fix completed in ${Math.round(elapsed / 1000)}s`,
            )
            resolve()
          })
        })

        // Give file system a moment to sync
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Retry the check
        log.progress(`Retrying ${check.name}`)
        const retryResult = await runCommandWithOutput(check.cmd, check.args, {
          cwd: rootPath,
        })

        if (retryResult.exitCode !== 0) {
          // Auto-fix didn't work - save failure to history.
          if (lastAnalysis) {
            await saveErrorHistory(
              lastErrorHash,
              'failed',
              lastAnalysis.strategies[0]?.name || 'auto-fix',
              lastAnalysis.rootCause,
            )
          }

          // Auto-fix didn't work
          if (autoFixAttempts >= MAX_AUTO_FIX_ATTEMPTS) {
            // Switch to interactive mode
            log.warn(`Auto-fix failed after ${MAX_AUTO_FIX_ATTEMPTS} attempts`)
            log.info('Switching to interactive mode for manual assistance')

            const interactivePrompt = `The command "${check.cmd} ${check.args.join(' ')}" is still failing after ${MAX_AUTO_FIX_ATTEMPTS} automatic fix attempts.

Latest error output:
${retryResult.stderr || retryResult.stdout || 'No error output'}

Previous automatic fixes were attempted but did not resolve the issue. This appears to be a more complex problem that requires interactive debugging.

Please help me fix this issue. You can:
1. Analyze the error more carefully
2. Try different approaches
3. Ask me questions if needed
4. Suggest manual steps I should take

Let's work through this together to get CI passing.`

            log.progress('Launching interactive Claude session')
            await runCommand(claudeCmd, prepareClaudeArgs([], opts), {
              input: interactivePrompt,
              cwd: rootPath,
              // Interactive mode
              stdio: 'inherit',
            })

            // Try once more after interactive session
            log.progress(`Final retry of ${check.name}`)
            const finalResult = await runCommandWithOutput(
              check.cmd,
              check.args,
              {
                cwd: rootPath,
              },
            )

            if (finalResult.exitCode !== 0) {
              log.error(`${check.name} still failing after manual intervention`)
              log.substep(
                'Consider running the command manually to debug further',
              )
              return false
            }
          } else {
            log.warn(`Auto-fix attempt ${autoFixAttempts} failed, will retry`)
            // Will try again on next iteration
            continue
          }
        }
      } else {
        // Already exceeded auto attempts, go straight to interactive
        log.warn('Maximum auto-fix attempts exceeded')
        log.info('Please fix this issue interactively')
        return false
      }
    }

    // Fix succeeded - save success to history.
    if (lastAnalysis) {
      await saveErrorHistory(
        lastErrorHash,
        'success',
        lastAnalysis.strategies[0]?.name || 'auto-fix',
        lastAnalysis.rootCause,
      )
    }

    log.done(`${check.name} passed`)
  }

  // End local checks phase.
  progress.endPhase()
  progress.showProgress()

  // Step 2: Commit and push changes
  progress.startPhase('commit-and-push')
  log.step('Committing and pushing changes')

  // Check for changes
  const statusResult = await runCommandWithOutput(
    'git',
    ['status', '--porcelain'],
    {
      cwd: rootPath,
    },
  )

  if (statusResult.stdout.trim()) {
    log.progress('Changes detected, committing')

    if (isDryRun) {
      log.done('[DRY RUN] Would commit and push changes')
    } else {
      // Stage all changes
      await runCommand('git', ['add', '.'], { cwd: rootPath })

      // Generate commit message using Claude (non-interactive)
      log.progress('Generating commit message with Claude')
      const commitMessage = await generateCommitMessage(
        claudeCmd,
        rootPath,
        opts,
      )
      log.substep(`Commit message: ${commitMessage}`)

      const commitArgs = ['commit', '-m', commitMessage]
      if (useNoVerify) {
        commitArgs.push('--no-verify')
      }
      await runCommand('git', commitArgs, {
        cwd: rootPath,
      })
      fixCount++

      // Validate before pushing
      const validation = await validateBeforePush(rootPath)
      if (!validation.valid) {
        log.warn('Pre-push validation warnings:')
        validation.warnings.forEach(warning => {
          log.substep(warning)
        })
        log.substep('Continuing with push (warnings are non-blocking)...')
      }

      // Push
      await runCommand('git', ['push'], { cwd: rootPath })
      log.done('Changes pushed to remote')
    }
  } else {
    log.info('No changes to commit')
  }

  // End commit phase.
  progress.endPhase()
  progress.showProgress()

  // Step 3: Monitor CI workflow
  progress.startPhase('ci-monitoring')
  log.step('Monitoring CI workflow')

  if (isDryRun) {
    log.done('[DRY RUN] Would monitor CI workflow')
    printFooter('Green CI Pipeline (dry run) complete!')
    return true
  }

  // Check for GitHub CLI
  const ghCheckCommand = WIN32 ? 'where' : 'which'
  const ghCheck = await runCommandWithOutput(ghCheckCommand, ['gh'])
  if (ghCheck.exitCode !== 0) {
    log.error('GitHub CLI (gh) is required for CI monitoring')
    console.log(`\n${colors.cyan('Installation Instructions:')}`)
    console.log(`  macOS:   ${colors.green('brew install gh')}`)
    console.log(`  Ubuntu:  ${colors.green('sudo apt install gh')}`)
    console.log(`  Fedora:  ${colors.green('sudo dnf install gh')}`)
    console.log(`  Windows: ${colors.green('winget install --id GitHub.cli')}`)
    console.log(
      `  Other:   ${colors.gray('https://github.com/cli/cli/blob/trunk/docs/install_linux.md')}`,
    )
    console.log(`\n${colors.yellow('After installation:')}`)
    console.log(`  1. Run: ${colors.green('gh auth login')}`)
    console.log('  2. Follow the prompts to authenticate')
    console.log(`  3. Try again: ${colors.green('pnpm claude --green')}`)
    return false
  }

  // Ensure GitHub is authenticated (will handle login automatically)
  const isGitHubAuthenticated = await ensureGitHubAuthenticated()
  if (!isGitHubAuthenticated) {
    log.error('Unable to authenticate with GitHub')
    console.log(
      colors.red('\nGitHub authentication is required for CI monitoring.'),
    )
    console.log('Please ensure you can login to GitHub CLI and try again.')
    return false
  }

  // Get current commit SHA
  const shaResult = await runCommandWithOutput('git', ['rev-parse', 'HEAD'], {
    cwd: rootPath,
  })
  let currentSha = shaResult.stdout.trim()

  // Get repo info
  const remoteResult = await runCommandWithOutput(
    'git',
    ['remote', 'get-url', 'origin'],
    {
      cwd: rootPath,
    },
  )
  const remoteUrl = remoteResult.stdout.trim()
  const repoMatch = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/)

  if (!repoMatch) {
    log.error('Could not determine GitHub repository from remote URL')
    return false
  }

  const [, owner, repoNameMatch] = repoMatch
  const repo = repoNameMatch.replace('.git', '')

  // Check if commit is part of a PR
  const prInfo = await checkIfCommitIsPartOfPR(currentSha, owner, repo)
  if (prInfo.isPR) {
    log.info(
      `Commit is part of PR #${prInfo.prNumber}: ${colors.cyan(prInfo.prTitle)}`,
    )
    log.substep(`PR state: ${prInfo.prState}`)
  } else {
    log.info('Commit is a direct push (not part of a PR)')
  }

  // Monitor workflow with retries
  let retryCount = 0
  let lastRunId = null
  let pushTime = Date.now()
  // Track which jobs we've already fixed (jobName -> true)
  let fixedJobs = new Map()
  // Track if we've made any commits during this workflow run
  let hasPendingCommits = false
  // Track polling attempts for adaptive delays
  let pollAttempt = 0

  while (retryCount < maxRetries) {
    // Reset tracking for each new CI run
    fixedJobs = new Map()
    hasPendingCommits = false
    pollAttempt = 0
    log.progress(`Checking CI status (attempt ${retryCount + 1}/${maxRetries})`)

    // Wait a bit for CI to start
    if (retryCount === 0) {
      log.substep('Waiting 10 seconds for CI to start...')
      await new Promise(resolve => setTimeout(resolve, 10_000))
    }

    // Check workflow runs using gh CLI with better detection
    const runsResult = await runCommandWithOutput(
      'gh',
      [
        'run',
        'list',
        '--repo',
        `${owner}/${repo}`,
        '--limit',
        '20',
        '--json',
        'databaseId,status,conclusion,name,headSha,createdAt,headBranch',
      ],
      {
        cwd: rootPath,
      },
    )

    if (runsResult.exitCode !== 0) {
      log.failed('Failed to fetch workflow runs')

      // Provide debugging information
      if (runsResult.stderr) {
        console.log(colors.red('\nError details:'))
        console.log(runsResult.stderr)
      }

      // Common troubleshooting steps
      console.log(colors.yellow('\nTroubleshooting:'))
      console.log('1. Check GitHub CLI authentication:')
      console.log(`   ${colors.green('gh auth status')}`)
      console.log('\n2. If not authenticated, login:')
      console.log(`   ${colors.green('gh auth login')}`)
      console.log('\n3. Test repository access:')
      console.log(`   ${colors.green(`gh api repos/${owner}/${repo}`)}`)
      console.log('\n4. Check if workflows exist:')
      console.log(
        `   ${colors.green(`gh workflow list --repo ${owner}/${repo}`)}`,
      )
      console.log('\n5. View recent runs manually:')
      console.log(
        `   ${colors.green(`gh run list --repo ${owner}/${repo} --limit 5`)}`,
      )

      return false
    }

    let runs
    try {
      runs = JSON.parse(runsResult.stdout || '[]')
    } catch {
      log.failed('Failed to parse workflow runs')
      return false
    }

    // Filter runs to find one matching our commit SHA or recent push
    let matchingRun = null

    // First, try exact SHA match
    for (const run of runs) {
      if (run.headSha?.startsWith(currentSha.substring(0, 7))) {
        matchingRun = run
        log.substep(
          `Found exact match for commit ${currentSha.substring(0, 7)}`,
        )
        break
      }
    }

    // If no exact match, look for runs created after our push
    if (!matchingRun && runs.length > 0) {
      for (const run of runs) {
        if (run.createdAt) {
          const runTime = new Date(run.createdAt).getTime()
          // Check if run was created within 2 minutes after push
          if (runTime >= pushTime - 120_000) {
            matchingRun = run
            log.substep(`Found workflow started after push: ${run.name}`)
            break
          }
        }
      }
    }

    // Last resort: if still no match on first attempt, monitor the newest run
    if (!matchingRun && retryCount === 0 && runs.length > 0) {
      const newestRun = runs[0]
      if (newestRun.createdAt) {
        const runTime = new Date(newestRun.createdAt).getTime()
        // Only consider if created within last 5 minutes
        if (Date.now() - runTime < 5 * 60 * 1000) {
          matchingRun = newestRun
          log.substep(`Monitoring recent workflow: ${newestRun.name}`)
        }
      }
    }

    if (!matchingRun) {
      // Use moderate delay when no run found yet (10s)
      const delay = 10_000
      log.substep(
        `No matching workflow runs found yet, waiting ${delay / 1000}s...`,
      )
      await new Promise(resolve => setTimeout(resolve, delay))
      pollAttempt++
      continue
    }

    const run = matchingRun
    lastRunId = run.databaseId

    log.substep(`Workflow "${run.name}" status: ${run.status}`)

    // Show progress update every 5 polls.
    if (pollAttempt % 5 === 0) {
      progress.showProgress()
    }

    // If workflow is queued, wait before checking again
    if (run.status === 'queued' || run.status === 'waiting') {
      const delay = calculatePollDelay(run.status, pollAttempt)
      log.substep(`Waiting for workflow to start (${delay / 1000}s)...`)
      await new Promise(resolve => setTimeout(resolve, delay))
      pollAttempt++
      continue
    }

    if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        // End CI monitoring phase.
        progress.endPhase()
        progress.complete()

        // Show final statistics.
        await celebrateSuccess(costTracker, {
          fixCount,
          retries: pollAttempt,
        })

        // Show available snapshots for reference.
        const snapshotList = snapshots.listSnapshots()
        if (snapshotList.length > 0) {
          console.log(colors.cyan('\n📸 Available Snapshots:'))
          snapshotList.slice(0, 5).forEach(snap => {
            console.log(
              `  ${snap.label} ${colors.gray(`(${formatDuration(Date.now() - snap.timestamp)} ago)`)}`,
            )
          })
          if (snapshotList.length > 5) {
            console.log(
              colors.gray(`  ... and ${snapshotList.length - 5} more`),
            )
          }
        }

        printFooter('Green CI Pipeline complete!')
        return true
      }
      log.failed(`CI workflow failed with conclusion: ${run.conclusion}`)

      // If we have pending commits from fixing jobs during execution, push them now
      if (hasPendingCommits) {
        log.progress('Pushing all fix commits')
        await runCommand('git', ['push'], { cwd: rootPath })
        log.done(`Pushed ${fixedJobs.size} fix commit(s)`)

        // Update SHA and push time for next check
        const newShaResult = await runCommandWithOutput(
          'git',
          ['rev-parse', 'HEAD'],
          {
            cwd: rootPath,
          },
        )
        currentSha = newShaResult.stdout.trim()
        pushTime = Date.now()

        // Reset retry count for new commit - it deserves its own attempts
        log.substep(
          `New commit ${currentSha.substring(0, 7)}, resetting retry counter`,
        )
        retryCount = 0

        // Wait for new CI run to start
        log.substep('Waiting 15 seconds for new CI run to start...')
        await new Promise(resolve => setTimeout(resolve, 15_000))
        continue
      }

      // No fixes were made during execution, handle as traditional completed workflow
      if (retryCount < maxRetries - 1) {
        // Fetch failure logs
        log.progress('Fetching failure logs')

        const logsResult = await runCommandWithOutput(
          'gh',
          [
            'run',
            'view',
            lastRunId.toString(),
            '--repo',
            `${owner}/${repo}`,
            '--log-failed',
          ],
          {
            cwd: rootPath,
          },
        )
        // Add newline after progress indicator before next output
        console.log('')

        // Filter and show summary of logs
        const rawLogs = logsResult.stdout || 'No logs available'
        const filteredLogs = filterCILogs(rawLogs)

        const logLines = filteredLogs.split('\n').slice(0, 10)
        log.substep('Error summary:')
        for (const line of logLines) {
          if (line.trim()) {
            log.substep(`  ${line.trim().substring(0, 100)}`)
          }
        }
        if (filteredLogs.split('\n').length > 10) {
          log.substep(
            `  ... (${filteredLogs.split('\n').length - 10} more lines)`,
          )
        }

        // Check if we've seen this CI error before
        const ciErrorHash = hashError(filteredLogs)

        if (ciErrorHistory.has(lastRunId)) {
          log.error(`Already attempted fix for run ${lastRunId}`)
          log.substep('Skipping to avoid repeated attempts on same CI run')
          retryCount++
          continue
        }

        if (seenErrors.has(ciErrorHash)) {
          log.error('Detected same CI error pattern as previous attempt')
          log.substep('Error appears unchanged after push')
          log.substep(
            `View run at: https://github.com/${owner}/${repo}/actions/runs/${lastRunId}`,
          )
          return false
        }

        ciErrorHistory.set(lastRunId, ciErrorHash)
        seenErrors.add(ciErrorHash)

        // Analyze and fix with Claude
        log.progress('Analyzing CI failure with Claude')

        // Keep logs under 2000 chars to avoid context issues
        const truncatedLogs =
          filteredLogs.length > 2000
            ? `${filteredLogs.substring(0, 2000)}\n... (truncated)`
            : filteredLogs

        const fixPrompt = `Fix CI failures for commit ${currentSha.substring(0, 7)} in ${owner}/${repo}.

Error logs:
${truncatedLogs}

Fix all issues by making necessary file changes. Be direct, don't ask questions.`

        // Run Claude non-interactively to apply fixes
        log.substep('Applying CI fixes...')

        // Track progress with timeout.
        const fixStartTime = Date.now()
        // 3 minutes timeout.
        const fixTimeout = 180_000

        // Create progress indicator
        const progressInterval = setInterval(() => {
          const elapsed = Date.now() - fixStartTime
          if (elapsed > fixTimeout) {
            log.warn('Claude fix timeout, proceeding...')
            clearInterval(progressInterval)
          } else {
            log.progress(
              `Claude analyzing and fixing... (${Math.round(elapsed / 1000)}s)`,
            )
          }
          // Update every 10 seconds.
        }, 10_000)

        try {
          // Write prompt to temp file
          const tmpFile = path.join(rootPath, `.claude-fix-${Date.now()}.txt`)
          await fs.writeFile(tmpFile, fixPrompt, 'utf8')

          const fixArgs = prepareClaudeArgs([], opts)
          const claudeArgs = fixArgs.join(' ')
          const claudeCommand = claudeArgs
            ? `${claudeCmd} ${claudeArgs}`
            : claudeCmd

          // Use script command to create pseudo-TTY for Ink compatibility
          // Platform-specific script command syntax
          let scriptCmd
          if (WIN32) {
            // Try winpty (comes with Git for Windows)
            const winptyCheck = await runCommandWithOutput('where', ['winpty'])
            if (winptyCheck.exitCode === 0) {
              scriptCmd = `winpty ${claudeCommand} < "${tmpFile}"`
            } else {
              // No winpty, try direct (may fail with raw mode error)
              scriptCmd = `${claudeCommand} < "${tmpFile}"`
            }
          } else {
            // Unix/macOS: use script command with quoted command
            scriptCmd = `script -q /dev/null sh -c '${claudeCommand} < "${tmpFile}"'`
          }

          const exitCode = await new Promise((resolve, _reject) => {
            const child = spawn(scriptCmd, [], {
              stdio: 'inherit',
              cwd: rootPath,
              shell: true,
            })

            // Handle Ctrl+C gracefully
            const sigintHandler = () => {
              child.kill('SIGINT')
              resolve(130)
            }
            process.on('SIGINT', sigintHandler)

            child.on('exit', code => {
              process.off('SIGINT', sigintHandler)
              resolve(code || 0)
            })

            child.on('error', () => {
              process.off('SIGINT', sigintHandler)
              resolve(1)
            })
          })

          // Clean up temp file
          try {
            await fs.unlink(tmpFile)
          } catch {}

          if (exitCode !== 0) {
            log.warn(`Claude fix exited with code ${exitCode}`)
          }
        } catch (error) {
          log.warn(`Claude fix error: ${error.message}`)
        } finally {
          clearInterval(progressInterval)
          log.done('Claude fix attempt completed')
        }

        // Give Claude's changes a moment to complete
        await new Promise(resolve => setTimeout(resolve, 3000))

        // Run local checks again
        log.progress('Running local checks after fixes')
        // Add newline after progress indicator before command output
        console.log('')
        for (const check of localChecks) {
          await runCommandWithOutput(check.cmd, check.args, {
            cwd: rootPath,
            stdio: 'inherit',
          })
        }

        // Commit and push fixes
        const fixStatusResult = await runCommandWithOutput(
          'git',
          ['status', '--porcelain'],
          {
            cwd: rootPath,
          },
        )

        let pushedNewCommit = false

        if (fixStatusResult.stdout.trim()) {
          log.progress('Committing CI fixes')

          // Show what files were changed
          const changedFiles = fixStatusResult.stdout
            .trim()
            .split('\n')
            .map(line => line.substring(3))
            .join(', ')
          log.substep(`Changed files: ${changedFiles}`)

          // Stage all changes
          await runCommand('git', ['add', '.'], { cwd: rootPath })

          // Generate commit message using Claude (non-interactive)
          log.progress('Generating CI fix commit message with Claude')
          const commitMessage = await generateCommitMessage(
            claudeCmd,
            rootPath,
            opts,
          )
          log.substep(`Commit message: ${commitMessage}`)

          // Validate before committing
          const validation = await validateBeforePush(rootPath)
          if (!validation.valid) {
            log.warn('Pre-commit validation warnings:')
            validation.warnings.forEach(warning => {
              log.substep(warning)
            })
          }

          // Commit with generated message
          const commitArgs = ['commit', '-m', commitMessage]
          if (useNoVerify) {
            commitArgs.push('--no-verify')
          }
          const commitResult = await runCommandWithOutput('git', commitArgs, {
            cwd: rootPath,
          })

          if (commitResult.exitCode === 0) {
            fixCount++
            // Push the commits
            await runCommand('git', ['push'], { cwd: rootPath })
            log.done('Pushed fix commits')

            // Update SHA and push time for next check
            const newShaResult = await runCommandWithOutput(
              'git',
              ['rev-parse', 'HEAD'],
              {
                cwd: rootPath,
              },
            )
            currentSha = newShaResult.stdout.trim()
            pushTime = Date.now()
            pushedNewCommit = true

            // Reset retry count for new commit - it deserves its own attempts
            log.substep(
              `New commit ${currentSha.substring(0, 7)}, resetting retry counter`,
            )
            retryCount = 0

            // Wait for new CI run to start
            log.substep('Waiting 15 seconds for new CI run to start...')
            await new Promise(resolve => setTimeout(resolve, 15_000))
          } else {
            log.warn(
              `Git commit failed: ${commitResult.stderr || commitResult.stdout}`,
            )
          }
        }

        // Only increment retry count if we didn't push a new commit
        if (!pushedNewCommit) {
          retryCount++
        }
      } else {
        log.error(`CI still failing after ${maxRetries} attempts`)
        log.substep(
          `View run at: https://github.com/${owner}/${repo}/actions/runs/${lastRunId}`,
        )
        return false
      }
    } else {
      // Workflow still running - check for failed jobs and fix them immediately
      log.substep('Workflow still running, checking for failed jobs...')

      // Fetch jobs for this workflow run
      const jobsResult = await runCommandWithOutput(
        'gh',
        [
          'run',
          'view',
          lastRunId.toString(),
          '--repo',
          `${owner}/${repo}`,
          '--json',
          'jobs',
        ],
        {
          cwd: rootPath,
        },
      )

      if (jobsResult.exitCode === 0 && jobsResult.stdout) {
        try {
          const runData = JSON.parse(jobsResult.stdout)
          const jobs = runData.jobs || []

          // Check for any failed or cancelled jobs
          const failedJobs = jobs.filter(
            job =>
              job.conclusion === 'failure' || job.conclusion === 'cancelled',
          )

          // Find new failures we haven't fixed yet
          const newFailures = failedJobs.filter(job => !fixedJobs.has(job.name))

          if (newFailures.length > 0) {
            log.failed(`Detected ${newFailures.length} new failed job(s)`)

            // Sort by priority - fix blocking issues first (build, typecheck, lint, tests)
            // Higher priority first
            const sortedFailures = newFailures.sort((a, b) => {
              const priorityA = getJobPriority(a.name)
              const priorityB = getJobPriority(b.name)
              return priorityB - priorityA
            })

            if (sortedFailures.length > 1) {
              log.substep('Processing in priority order (highest first):')
              sortedFailures.forEach(job => {
                const priority = getJobPriority(job.name)
                log.substep(`  [Priority ${priority}] ${job.name}`)
              })
            }

            // Fix each failed job immediately
            for (const job of sortedFailures) {
              log.substep(`${colors.red('✗')} ${job.name}: ${job.conclusion}`)

              // Fetch logs for this specific failed job using job ID
              log.progress(`Fetching logs for ${job.name}`)
              const logsResult = await runCommandWithOutput(
                'gh',
                [
                  'run',
                  'view',
                  '--job',
                  job.databaseId.toString(),
                  '--repo',
                  `${owner}/${repo}`,
                  '--log',
                ],
                {
                  cwd: rootPath,
                },
              )
              console.log('')

              // Filter logs to extract relevant errors
              const rawLogs = logsResult.stdout || 'No logs available'
              const filteredLogs = filterCILogs(rawLogs)

              // Show summary to user (not full logs)
              const logLines = filteredLogs.split('\n').slice(0, 10)
              log.substep('Error summary:')
              for (const line of logLines) {
                if (line.trim()) {
                  log.substep(`  ${line.trim().substring(0, 100)}`)
                }
              }
              if (filteredLogs.split('\n').length > 10) {
                log.substep(
                  `  ... (${filteredLogs.split('\n').length - 10} more lines)`,
                )
              }

              // Analyze and fix with Claude
              log.progress(`Analyzing failure in ${job.name}`)

              // Keep logs under 2000 chars to avoid context issues
              const truncatedLogs =
                filteredLogs.length > 2000
                  ? `${filteredLogs.substring(0, 2000)}\n... (truncated)`
                  : filteredLogs

              const fixPrompt = `Fix CI failure in "${job.name}" (run ${lastRunId}, commit ${currentSha.substring(0, 7)}).

Status: ${job.conclusion}

Error logs:
${truncatedLogs}

Fix the issue by making necessary file changes. Be direct, don't ask questions.`

              // Run Claude non-interactively to apply fixes
              log.substep(`Applying fix for ${job.name}...`)

              const fixStartTime = Date.now()
              const fixTimeout = 180_000

              const progressInterval = setInterval(() => {
                const elapsed = Date.now() - fixStartTime
                if (elapsed > fixTimeout) {
                  log.warn('Claude fix timeout, proceeding...')
                  clearInterval(progressInterval)
                } else {
                  log.progress(
                    `Claude fixing ${job.name}... (${Math.round(elapsed / 1000)}s)`,
                  )
                }
              }, 10_000)

              try {
                // Write prompt to temp file
                const tmpFile = path.join(
                  rootPath,
                  `.claude-fix-${Date.now()}.txt`,
                )
                await fs.writeFile(tmpFile, fixPrompt, 'utf8')

                const fixArgs = prepareClaudeArgs([], opts)
                const claudeArgs = fixArgs.join(' ')
                const claudeCommand = claudeArgs
                  ? `${claudeCmd} ${claudeArgs}`
                  : claudeCmd

                // Debug: Show command being run
                if (claudeArgs) {
                  log.substep(`Running: claude ${claudeArgs}`)
                }

                // Use script command to create pseudo-TTY for Ink compatibility
                // Platform-specific script command syntax
                let scriptCmd
                if (WIN32) {
                  // Try winpty (comes with Git for Windows)
                  const winptyCheck = await runCommandWithOutput('where', [
                    'winpty',
                  ])
                  if (winptyCheck.exitCode === 0) {
                    scriptCmd = `winpty ${claudeCommand} < "${tmpFile}"`
                  } else {
                    // No winpty, try direct (may fail with raw mode error)
                    scriptCmd = `${claudeCommand} < "${tmpFile}"`
                  }
                } else {
                  // Unix/macOS: use script command with quoted command
                  scriptCmd = `script -q /dev/null sh -c '${claudeCommand} < "${tmpFile}"'`
                }

                const exitCode = await new Promise((resolve, _reject) => {
                  const child = spawn(scriptCmd, [], {
                    stdio: 'inherit',
                    cwd: rootPath,
                    shell: true,
                  })

                  // Handle Ctrl+C gracefully
                  const sigintHandler = () => {
                    child.kill('SIGINT')
                    resolve(130)
                  }
                  process.on('SIGINT', sigintHandler)

                  child.on('exit', code => {
                    process.off('SIGINT', sigintHandler)
                    resolve(code || 0)
                  })

                  child.on('error', () => {
                    process.off('SIGINT', sigintHandler)
                    resolve(1)
                  })
                })

                // Clean up temp file
                try {
                  await fs.unlink(tmpFile)
                } catch {}

                if (exitCode !== 0) {
                  log.warn(`Claude fix exited with code ${exitCode}`)
                }
              } catch (error) {
                log.warn(`Claude fix error: ${error.message}`)
              } finally {
                clearInterval(progressInterval)
                log.done(`Fix attempt for ${job.name} completed`)
              }

              // Give Claude's changes a moment to complete
              await new Promise(resolve => setTimeout(resolve, 2000))

              // Run local checks
              log.progress('Running local checks after fix')
              console.log('')
              for (const check of localChecks) {
                await runCommandWithOutput(check.cmd, check.args, {
                  cwd: rootPath,
                  stdio: 'inherit',
                })
              }

              // Check if there are changes to commit
              const fixStatusResult = await runCommandWithOutput(
                'git',
                ['status', '--porcelain'],
                {
                  cwd: rootPath,
                },
              )

              if (fixStatusResult.stdout.trim()) {
                log.progress(`Committing fix for ${job.name}`)

                const changedFiles = fixStatusResult.stdout
                  .trim()
                  .split('\n')
                  .map(line => line.substring(3))
                  .join(', ')
                log.substep(`Changed files: ${changedFiles}`)

                // Stage all changes
                await runCommand('git', ['add', '.'], { cwd: rootPath })

                // Generate commit message using Claude (non-interactive)
                log.progress(
                  `Generating commit message for ${job.name} fix with Claude`,
                )
                const commitMessage = await generateCommitMessage(
                  claudeCmd,
                  rootPath,
                  opts,
                )
                log.substep(`Commit message: ${commitMessage}`)

                // Validate before committing
                const validation = await validateBeforePush(rootPath)
                if (!validation.valid) {
                  log.warn('Pre-commit validation warnings:')
                  validation.warnings.forEach(warning => {
                    log.substep(warning)
                  })
                }

                // Commit with generated message
                const commitArgs = ['commit', '-m', commitMessage]
                if (useNoVerify) {
                  commitArgs.push('--no-verify')
                }
                const commitResult = await runCommandWithOutput(
                  'git',
                  commitArgs,
                  {
                    cwd: rootPath,
                  },
                )

                if (commitResult.exitCode === 0) {
                  fixCount++
                  log.done(`Committed fix for ${job.name}`)
                  hasPendingCommits = true
                } else {
                  log.warn(
                    `Git commit failed: ${commitResult.stderr || commitResult.stdout}`,
                  )
                }
              } else {
                log.substep(`No changes to commit for ${job.name}`)
              }

              // Mark this job as fixed
              fixedJobs.set(job.name, true)
            }
          }

          // Show current status
          if (fixedJobs.size > 0) {
            log.substep(
              `Fixed ${fixedJobs.size} job(s) so far (commits pending push)`,
            )
          }
        } catch (e) {
          log.warn(`Failed to parse job data: ${e.message}`)
        }
      }

      // Wait and check again with adaptive polling
      // Jobs are running, so poll more frequently
      const delay = calculatePollDelay('in_progress', pollAttempt, true)
      log.substep(`Checking again in ${delay / 1000}s...`)
      await new Promise(resolve => setTimeout(resolve, delay))
      pollAttempt++
    }
  }

  log.error(`Exceeded maximum retries (${maxRetries})`)
  return false
}

/**
 * Continuous monitoring mode - watches for changes and auto-fixes issues.
 */
async function runWatchMode(claudeCmd, options = {}) {
  const opts = { __proto__: null, ...options }
  printHeader('Watch Mode - Continuous Monitoring')

  log.info('Starting continuous monitoring...')
  log.substep('Press Ctrl+C to stop')

  const _watchPath = !opts['cross-repo'] ? rootPath : parentPath
  const projects = !opts['cross-repo']
    ? [{ name: path.basename(rootPath), path: rootPath }]
    : SOCKET_PROJECTS.map(name => ({
        name,
        path: path.join(parentPath, name),
      })).filter(p => existsSync(p.path))

  log.substep(`Monitoring ${projects.length} project(s)`)

  // Track last scan time to avoid duplicate scans
  const lastScanTime = new Map()
  // 5 seconds between scans
  const SCAN_COOLDOWN = 5000

  // File watcher for each project
  const watchers = []

  for (const project of projects) {
    log.substep(`Watching: ${project.name}`)

    const watcher = fs.watch(
      project.path,
      { recursive: true },
      async (_eventType, filename) => {
        // Skip common ignore patterns
        if (
          !filename ||
          filename.includes('node_modules') ||
          filename.includes('.git') ||
          filename.includes('dist') ||
          filename.includes('build') ||
          !filename.match(/\.(m?[jt]sx?)$/)
        ) {
          return
        }

        const now = Date.now()
        const lastScan = lastScanTime.get(project.name) || 0

        // Cooldown to avoid rapid re-scans
        if (now - lastScan < SCAN_COOLDOWN) {
          return
        }

        lastScanTime.set(project.name, now)

        log.progress(`Change detected in ${project.name}/${filename}`)
        log.substep('Scanning for issues...')

        try {
          // Run focused scan on changed file
          const scanResults = await scanProjectForIssues(claudeCmd, project, {
            ...opts,
            focusFiles: [filename],
            smartContext: true,
          })

          if (scanResults && Object.keys(scanResults).length > 0) {
            log.substep('Issues detected, auto-fixing...')

            // Auto-fix in careful mode
            await autonomousFixSession(
              claudeCmd,
              { [project.name]: scanResults },
              [project],
              {
                ...opts,
                // Force auto-fix in watch mode
                prompt: false,
              },
            )
          } else {
            log.done('No issues found')
          }
        } catch (error) {
          log.failed(`Error scanning ${project.name}: ${error.message}`)
        }
      },
    )

    watchers.push(watcher)
  }

  // Periodic full scans (every 30 minutes)
  const fullScanInterval = setInterval(
    async () => {
      log.step('Running periodic full scan')

      for (const project of projects) {
        try {
          const scanResults = await scanProjectForIssues(
            claudeCmd,
            project,
            opts,
          )

          if (scanResults && Object.keys(scanResults).length > 0) {
            await autonomousFixSession(
              claudeCmd,
              { [project.name]: scanResults },
              [project],
              {
                ...opts,
                prompt: false,
              },
            )
          }
        } catch (error) {
          log.failed(`Full scan error in ${project.name}: ${error.message}`)
        }
      }
      // 30 minutes
    },
    30 * 60 * 1000,
  )

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n${colors.yellow('Stopping watch mode...')}`)

    // Clean up watchers
    for (const watcher of watchers) {
      watcher.close()
    }

    // Clear interval
    if (fullScanInterval) {
      clearInterval(fullScanInterval)
    }

    log.success('Watch mode stopped')
    process.exitCode = 0

    process.exit(0)
  })

  // Keep process alive
  await new Promise(() => {})
}

/**
 * Show available Claude operations.
 */
function showOperations() {
  console.log('\nCore operations:')
  console.log('  --commit       Create commits with Claude assistance')
  console.log(
    '  --green        Ensure all tests pass, push, monitor CI until green',
  )
  console.log('  --push         Create commits and push to remote')
  console.log('  --sync         Synchronize CLAUDE.md files across projects')

  console.log('\nCode quality:')
  console.log('  --audit        Security and quality audit')
  console.log('  --clean        Find unused code and imports')
  console.log('  --fix          Scan for bugs and security issues')
  console.log('  --optimize     Performance optimization analysis')
  console.log('  --refactor     Suggest code improvements')
  console.log('  --review       Review staged changes before committing')

  console.log('\nDevelopment:')
  console.log('  --debug        Help debug errors')
  console.log('  --deps         Analyze dependencies')
  console.log('  --docs         Generate documentation')
  console.log('  --explain      Explain code or concepts')
  console.log('  --migrate      Migration assistance')
  console.log('  --test         Generate test cases')

  console.log('\nUtility:')
  console.log('  --help         Show this help message')
}

async function main() {
  try {
    // Parse arguments.
    const { positionals, values } = parseArgs({
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
        green: {
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
        'cross-repo': {
          type: 'boolean',
          default: false,
        },
        'no-darkwing': {
          type: 'boolean',
          default: false,
        },
        seq: {
          type: 'boolean',
          default: false,
        },
        'max-retries': {
          type: 'string',
          default: '3',
        },
        'max-auto-fixes': {
          type: 'string',
          default: '10',
        },
        pinky: {
          type: 'boolean',
          default: false,
        },
        'the-brain': {
          type: 'boolean',
          default: false,
        },
        workers: {
          type: 'string',
          default: '3',
        },
        watch: {
          type: 'boolean',
          default: false,
        },
        prompt: {
          type: 'boolean',
          default: false,
        },
      },
      allowPositionals: true,
      strict: false,
    })

    // Check if any operation is specified.
    const hasOperation =
      values.sync ||
      values.fix ||
      values.commit ||
      values.push ||
      values.review ||
      values.refactor ||
      values.optimize ||
      values.clean ||
      values.audit ||
      values.test ||
      values.docs ||
      values.explain ||
      values.debug ||
      values.deps ||
      values.migrate ||
      values.green

    // Show help if requested or no operation specified.
    if (values.help || !hasOperation) {
      console.log('\nUsage: pnpm claude [operation] [options] [files...]')
      console.log('\nClaude-powered utilities for Socket projects.')
      showOperations()
      console.log('\nOptions:')
      console.log(
        '  --cross-repo     Operate on all Socket projects (default: current only)',
      )
      console.log('  --dry-run        Preview changes without writing files')
      console.log(
        '  --max-auto-fixes N  Max auto-fix attempts (--green, default: 10)',
      )
      console.log(
        '  --max-retries N  Max CI fix attempts (--green, default: 3)',
      )
      console.log('  --no-darkwing    Disable "Let\'s get dangerous!" mode')
      console.log('  --no-report      Skip generating scan report (--fix)')
      console.log('  --no-verify      Use --no-verify when committing')
      console.log('  --pinky          Use default model (Claude 3.5 Sonnet)')
      console.log('  --prompt         Prompt for approval before fixes (--fix)')
      console.log('  --seq            Run sequentially (default: parallel)')
      console.log("  --skip-commit    Update files but don't commit")
      console.log(
        '  --the-brain      Use ultrathink mode - "Try to take over the world!"',
      )
      console.log('  --watch          Continuous monitoring mode')
      console.log('  --workers N      Number of parallel workers (default: 3)')
      console.log('\nExamples:')
      console.log(
        '  pnpm claude --fix            # Auto-fix issues (careful mode)',
      )
      console.log(
        '  pnpm claude --fix --prompt   # Prompt for approval on each fix',
      )
      console.log(
        '  pnpm claude --fix --watch    # Continuous monitoring & fixing',
      )
      console.log('  pnpm claude --review         # Review staged changes')
      console.log('  pnpm claude --green          # Ensure CI passes')
      console.log(
        '  pnpm claude --green --dry-run  # Test green without real CI',
      )
      console.log(
        '  pnpm claude --fix --the-brain  # Deep analysis with ultrathink mode',
      )
      console.log('  pnpm claude --fix --workers 5  # Use 5 parallel workers')
      console.log(
        '  pnpm claude --test lib/utils.js  # Generate tests for a file',
      )
      console.log(
        '  pnpm claude --refactor src/index.js  # Suggest refactoring',
      )
      console.log('  pnpm claude --push           # Commit and push changes')
      console.log('  pnpm claude --help           # Show this help')
      console.log('\nRequires:')
      console.log('  - Claude Code CLI (claude) installed')
      console.log('  - GitHub CLI (gh) for --green command')
      process.exitCode = 0
      return
    }

    // Check for Claude CLI.
    log.step('Checking prerequisites')
    log.progress('Checking for Claude Code CLI')
    const claudeCmd = await checkClaude()
    if (!claudeCmd) {
      log.failed('Claude Code CLI not found')
      log.error('Please install Claude Code to use these utilities')
      console.log(`\n${colors.cyan('Installation Instructions:')}`)
      console.log('  1. Visit: https://docs.claude.com/en/docs/claude-code')
      console.log('  2. Or install via npm:')
      console.log(
        `     ${colors.green('npm install -g @anthropic/claude-desktop')}`,
      )
      console.log('  3. Or download directly:')
      console.log(`     macOS: ${colors.gray('brew install claude')}`)
      console.log(
        `     Linux: ${colors.gray('curl -fsSL https://docs.claude.com/install.sh | sh')}`,
      )
      console.log(
        `     Windows: ${colors.gray('Download from https://claude.ai/download')}`,
      )
      console.log(`\n${colors.yellow('After installation:')}`)
      console.log(`  1. Run: ${colors.green('claude')}`)
      console.log('  2. Sign in with your Anthropic account when prompted')
      console.log(`  3. Try again: ${colors.green('pnpm claude --help')}`)
      process.exitCode = 1
      return
    }

    // Ensure Claude is authenticated
    const isClaudeAuthenticated = await ensureClaudeAuthenticated(claudeCmd)
    if (!isClaudeAuthenticated) {
      log.error('Unable to authenticate with Claude Code')
      console.log(
        colors.red('\nAuthentication is required to use Claude utilities.'),
      )
      console.log(
        'Please ensure Claude Code is properly authenticated and try again.',
      )
      process.exitCode = 1
      return
    }

    // Configure execution mode based on flags
    const executionMode = {
      workers: Number.parseInt(values.workers, 10) || 3,
      watch: values.watch || false,
      // Auto-fix by default unless --prompt
      autoFix: !values.prompt,
      model: values['the-brain']
        ? 'the-brain'
        : values.pinky
          ? 'pinky'
          : 'auto',
    }

    // Display execution mode
    if (executionMode.workers > 1) {
      log.substep(`🚀 Parallel mode: ${executionMode.workers} workers`)
    }
    if (executionMode.watch) {
      log.substep('Watch mode: Continuous monitoring enabled')
    }
    if (!executionMode.autoFix) {
      log.substep('Prompt mode: Fixes require approval')
    }

    // Execute requested operation.
    let success = true
    const options = { ...values, positionals, executionMode }

    // Check if watch mode is enabled
    if (executionMode.watch) {
      // Start continuous monitoring
      await runWatchMode(claudeCmd, options)
      // Watch mode runs indefinitely
      return
    }

    // Core operations.
    if (values.sync) {
      success = await syncClaudeMd(claudeCmd, options)
    } else if (values.commit) {
      success = await runClaudeCommit(claudeCmd, options)
    } else if (values.push) {
      // --push combines commit and push.
      success = await runClaudeCommit(claudeCmd, { ...options, push: true })
    } else if (values.green) {
      success = await runGreen(claudeCmd, options)
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
