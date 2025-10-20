/**
 * Demo: Socket CLI Ask Mode
 *
 * Demonstrates natural language intent parsing for Socket commands.
 * Shows various query patterns and how they map to Socket commands.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const cliPath = path.join(rootDir, 'dist/cli.js')

// Demo queries showcasing different capabilities.
const DEMO_QUERIES = [
  {
    category: '🔍 Security Scanning',
    queries: [
      'scan for vulnerabilities',
      'check my dependencies for issues',
      'audit my project',
      'find security problems',
    ],
  },
  {
    category: '🔧 Fixing Issues',
    queries: [
      'fix critical vulnerabilities',
      'fix all security alerts',
      'resolve high severity issues',
      'update packages to fix CVEs',
    ],
  },
  {
    category: '📦 Package Safety',
    queries: [
      'is express safe',
      'check lodash security',
      'is @babel/core trustworthy',
      'what is the score for react',
    ],
  },
  {
    category: '⚡ Optimization',
    queries: [
      'optimize my dependencies',
      'replace packages with better alternatives',
      'improve package quality',
      'enhance security with socket registry',
    ],
  },
  {
    category: '🩹 Patching',
    queries: ['patch vulnerabilities', 'apply security patches'],
  },
  {
    category: '🎯 Advanced Queries',
    queries: [
      'scan production dependencies only',
      'fix critical issues dry run',
      'check express for medium severity issues',
    ],
  },
]

// ANSI color codes.
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
}

/**
 * Execute ask command and capture output.
 */
async function executeAsk(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, 'ask', query], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' }, // Disable colors for parsing
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', data => {
      stdout += data.toString()
    })

    child.stderr.on('data', data => {
      stderr += data.toString()
    })

    child.on('close', code => {
      resolve({ stdout: stdout + stderr, code })
    })

    child.on('error', reject)
  })
}

/**
 * Print section header.
 */
function printHeader(text) {
  console.log(
    `\n${colors.bright}${colors.cyan}${'═'.repeat(70)}${colors.reset}`,
  )
  console.log(`${colors.bright}${colors.cyan}  ${text}${colors.reset}`)
  console.log(
    `${colors.bright}${colors.cyan}${'═'.repeat(70)}${colors.reset}\n`,
  )
}

/**
 * Print category header.
 */
function printCategory(text) {
  console.log(`\n${colors.bright}${colors.magenta}${text}${colors.reset}`)
  console.log(`${colors.dim}${'─'.repeat(70)}${colors.reset}\n`)
}

/**
 * Print query with result.
 */
function printQueryResult(query, output) {
  // Extract the key parts from output.
  const lines = output.split('\n')

  // Find the command line (look for "$ socket" pattern).
  const commandLineIndex = lines.findIndex(line => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape code pattern
    const cleaned = line.replace(/\x1b\[[0-9;]*m/g, '')
    return cleaned.includes('$ socket') || cleaned.trim().startsWith('$ socket')
  })

  let command = ''
  if (commandLineIndex !== -1) {
    command = lines[commandLineIndex]
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape code pattern
      .replace(/\x1b\[[0-9;]*m/g, '')
      .trim()
  }

  console.log(`${colors.bright}"${query}"${colors.reset}`)
  if (command) {
    console.log(
      `${colors.dim}  →${colors.reset} ${colors.green}${command}${colors.reset}`,
    )
  } else {
    console.log(`${colors.dim}  → [parsing...]${colors.reset}`)
  }
  console.log()
}

/**
 * Main demo function.
 */
async function main() {
  console.clear()

  printHeader('Socket CLI Ask Mode - Interactive Demo')

  console.log(
    `${colors.dim}Ask Socket CLI what you want in plain English,${colors.reset}`,
  )
  console.log(
    `${colors.dim}and it translates to the right Socket command.${colors.reset}`,
  )

  for (const { category, queries } of DEMO_QUERIES) {
    printCategory(category)

    for (const query of queries) {
      const result = await executeAsk(query)
      printQueryResult(query, result.stdout)

      // Small delay for readability.
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  printHeader('Demo Complete')

  console.log(`${colors.bright}${colors.cyan}Try it yourself:${colors.reset}`)
  console.log(
    `  ${colors.dim}$${colors.reset} socket ask "${colors.yellow}scan for vulnerabilities${colors.reset}"`,
  )
  console.log(
    `  ${colors.dim}$${colors.reset} socket ask "${colors.yellow}is express safe${colors.reset}"`,
  )
  console.log(
    `  ${colors.dim}$${colors.reset} socket ask "${colors.yellow}fix critical issues${colors.reset}" ${colors.green}--execute${colors.reset}`,
  )
  console.log()
}

main().catch(error => {
  console.error('Demo failed:', error)
  process.exit(1)
})
