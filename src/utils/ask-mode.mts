/** @fileoverview Interactive ask mode for no-command scenarios */

import { spawn } from 'node:child_process'
import process from 'node:process'

import colors from 'yoctocolors-cjs'

import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm, input, select } from '@socketsecurity/registry/lib/prompts'

import type { Choice } from '@socketsecurity/registry/lib/prompts'

interface CommonAction {
  name: string
  description: string
  command: string[]
  category: string
}

const COMMON_ACTIONS: CommonAction[] = [
  // Security Scanning
  {
    name: 'Scan this project',
    description: 'Create a security scan of current directory',
    command: ['scan', 'create', '.'],
    category: 'Scanning',
  },
  {
    name: 'Scan production dependencies only',
    description: 'Scan only production deps',
    command: ['scan', 'create', '.', '--prod'],
    category: 'Scanning',
  },
  {
    name: 'View recent scans',
    description: 'List your recent security scans',
    command: ['scan', 'list'],
    category: 'Scanning',
  },

  // Fixing & Optimization
  {
    name: 'Fix vulnerabilities',
    description: 'Interactive vulnerability fixing',
    command: ['fix', 'interactive'],
    category: 'Fixing',
  },
  {
    name: 'Auto-fix safe issues',
    description: 'Automatically apply safe fixes',
    command: ['fix', '--auto'],
    category: 'Fixing',
  },
  {
    name: 'Optimize dependencies',
    description: 'Clean up and optimize packages',
    command: ['optimize', '.'],
    category: 'Optimization',
  },

  // Package Management
  {
    name: 'Check package security',
    description: 'Get security score for a package',
    command: ['package', 'score'],
    category: 'Packages',
  },
  {
    name: 'Install with npm wrapper',
    description: 'Secure npm install',
    command: ['npm', 'install'],
    category: 'Packages',
  },

  // Authentication & Config
  {
    name: 'Log in to Socket',
    description: 'Authenticate with Socket.dev',
    command: ['login'],
    category: 'Setup',
  },
  {
    name: 'View configuration',
    description: 'Show current CLI configuration',
    command: ['config', 'list'],
    category: 'Setup',
  },
  {
    name: 'Who am I?',
    description: 'Show current user information',
    command: ['whoami'],
    category: 'Setup',
  },

  // Help
  {
    name: 'View help documentation',
    description: 'Interactive help system',
    command: ['--help'],
    category: 'Help',
  },
  {
    name: 'Natural language query',
    description: 'Describe what you want in plain English',
    command: ['ask'],
    category: 'Help',
  },
]

/**
 * Parse natural language input to find matching commands
 */
function parseNaturalInput(query: string): CommonAction | null {
  const normalized = query.toLowerCase().trim()

  // Direct command patterns
  const patterns: Array<{ pattern: RegExp; action: CommonAction }> = [
    {
      pattern: /^(scan|check|analyze)(\s|$)/i,
      action: COMMON_ACTIONS.find(a => a.name === 'Scan this project')!,
    },
    {
      pattern: /^fix(\s|$)/i,
      action: COMMON_ACTIONS.find(a => a.name === 'Fix vulnerabilities')!,
    },
    {
      pattern: /^optimize(\s|$)/i,
      action: COMMON_ACTIONS.find(a => a.name === 'Optimize dependencies')!,
    },
    {
      pattern: /^(login|authenticate)(\s|$)/i,
      action: COMMON_ACTIONS.find(a => a.name === 'Log in to Socket')!,
    },
    {
      pattern: /^(help|\?)(\s|$)/i,
      action: COMMON_ACTIONS.find(a => a.name === 'View help documentation')!,
    },
  ]

  for (const { action, pattern } of patterns) {
    if (pattern.test(normalized)) {
      return action
    }
  }

  // Try to match against action names
  for (const action of COMMON_ACTIONS) {
    if (normalized.includes(action.name.toLowerCase())) {
      return action
    }
  }

  return null
}

/**
 * Execute a Socket CLI command
 */
async function executeCommand(args: string[]): Promise<void> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.argv[0]!, [process.argv[1]!, ...args], {
      stdio: 'inherit',
      env: process.env,
    })

    child.on('error', reject)
    child.on('exit', (code: number | null) => {
      process.exitCode = code || 0
      resolve()
    })
  })
}

/**
 * Run the interactive ask mode
 */
export async function runAskMode(): Promise<void> {
  // Non-interactive fallback
  if (!isInteractive()) {
    // Add spacing before the prompt for better visual separation
    logger.log('')
    logger.log(colors.bold('What would you like to do?'))
    logger.log('')
    logger.log('Common actions:')
    logger.log('  socket scan create .         # Scan this project')
    logger.log('  socket fix interactive       # Fix vulnerabilities')
    logger.log('  socket optimize .           # Optimize dependencies')
    logger.log('  socket login                # Authenticate')
    logger.log('  socket --help               # View help')
    logger.log('')
    logger.log(colors.gray('💡 Run in an interactive terminal for a better experience'))
    return
  }

  // First, ask what they want to do
  const query = await input({
    message: 'What would you like to do? (describe in plain English or press Enter for options)',
  })

  let selectedAction: CommonAction | null = null

  if (query && query.trim()) {
    // Try to parse natural language
    selectedAction = parseNaturalInput(query)

    if (!selectedAction) {
      // If we can't parse it, pass it to the ask command
      logger.log('')
      logger.log(colors.cyan('Running natural language interpreter...'))
      logger.log('')
      await executeCommand(['ask', query])
      return
    }
  } else {
    // Show action menu
    const categories = [...new Set(COMMON_ACTIONS.map(a => a.category))]
    const choices: Array<Choice<CommonAction | string>> = []

    for (const category of categories) {
      // Add category separator
      choices.push({
        name: colors.bold(colors.cyan(`── ${category} ──`)),
        value: `separator-${category}`,
        disabled: true,
      } as any)

      // Add actions in this category
      const categoryActions = COMMON_ACTIONS.filter(a => a.category === category)
      for (const action of categoryActions) {
        choices.push({
          name: `  ${action.name}`,
          value: action,
          short: action.name,
          description: colors.gray(action.description),
        })
      }
    }

    const selected = await select({
      message: 'What would you like to do?',
      choices,
    })

    if (!selected || typeof selected === 'string') {
      return
    }

    selectedAction = selected as CommonAction
  }

  if (!selectedAction) {
    return
  }

  // Show the command that will be executed
  const commandStr = `socket ${selectedAction.command.join(' ')}`

  logger.log('')
  logger.log(colors.cyan('Command:') + ` ${colors.bold(commandStr)}`)

  // Special handling for commands that need additional input
  const finalCommand = [...selectedAction.command]

  if (selectedAction.name === 'Check package security') {
    const pkg = await input({
      message: 'Which package would you like to check?',
    })
    if (!pkg) {
      return
    }
    finalCommand.push(pkg)
  } else if (selectedAction.name === 'Install with npm wrapper') {
    const pkg = await input({
      message: 'What would you like to install? (package name or leave empty for all)',
    })
    if (pkg) {
      finalCommand.push(pkg)
    }
  } else if (selectedAction.name === 'Natural language query') {
    const nlQuery = await input({
      message: 'What would you like to do? (describe in plain English)',
    })
    if (!nlQuery) {
      return
    }
    finalCommand.push(nlQuery)
  }

  // Update command display if modified
  if (finalCommand.length !== selectedAction.command.length) {
    const updatedCommandStr = `socket ${finalCommand.join(' ')}`
    logger.log(colors.gray('Updated:') + ` ${colors.bold(updatedCommandStr)}`)
  }

  // Confirm execution
  const shouldExecute = await confirm({
    message: 'Execute this command?',
    default: true,
  })

  if (shouldExecute) {
    logger.log('')
    await executeCommand(finalCommand)
  }
}