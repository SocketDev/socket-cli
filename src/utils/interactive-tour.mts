/** @fileoverview Interactive tour system for Socket CLI */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stdin, stdout } from 'node:process'
import readline from 'node:readline/promises'

import colors from 'yoctocolors-cjs'

import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { logger } from '@socketsecurity/registry/lib/logger'

interface TourStep {
  title: string
  description: string
  example?: string
  command?: string
  canRun?: boolean
  tips?: string[]
  nextPrompt?: string
}

const tourSteps: TourStep[] = [
  {
    title: 'Welcome to Socket CLI! 👋',
    description: `Socket CLI helps you secure your software supply chain by finding and fixing vulnerabilities in your dependencies.

Let's take a quick tour of the main features!`,
    tips: [
      'This tour will show you real commands you can use',
      'Some commands can be run safely during the tour',
      'You can exit at any time by pressing Ctrl+C',
    ],
    nextPrompt: 'Ready to start?',
  },
  {
    title: '🔐 Step 1: Authentication',
    description: 'First, you need to authenticate with Socket to access all features.',
    example: 'socket login',
    command: 'socket whoami',
    canRun: true,
    tips: [
      'Your API token is stored securely in your local config',
      'You can also set SOCKET_CLI_API_TOKEN environment variable',
      'Use `socket logout` to remove stored credentials',
    ],
    nextPrompt: 'Let me check if you\'re logged in...',
  },
  {
    title: '🔍 Step 2: Scanning for Vulnerabilities',
    description: 'Socket can scan your project to find security issues in dependencies.',
    example: 'socket scan create .',
    command: 'socket scan create . --dry-run',
    canRun: true,
    tips: [
      'Use --prod to scan only production dependencies',
      'Add --reach to check if vulnerable code is actually used',
      'Scans are cached for offline use',
    ],
    nextPrompt: 'Want to see a scan preview?',
  },
  {
    title: '📊 Step 3: Checking Package Safety',
    description: 'Before installing a package, check its security score.',
    example: 'socket package score lodash',
    command: 'socket package score lodash',
    canRun: true,
    tips: [
      'Score is 0-100 (higher is better)',
      'Checks for vulnerabilities, maintenance, licensing',
      'Works for npm, PyPI, and other ecosystems',
    ],
    nextPrompt: 'Should I check lodash\'s score?',
  },
  {
    title: '💬 Step 4: Natural Language Interface',
    description: 'Don\'t remember the exact command? Just ask in plain English!',
    example: 'socket ask "is express safe to use"',
    command: 'socket ask "show me how to scan for vulnerabilities"',
    canRun: true,
    tips: [
      'Translates natural language to Socket commands',
      'Shows you the actual command it will run',
      'Use --execute to run the command directly',
    ],
    nextPrompt: 'Want to try the natural language interface?',
  },
  {
    title: '🔧 Step 5: Fixing Vulnerabilities',
    description: 'Socket can help you fix security issues automatically or interactively.',
    example: 'socket fix interactive',
    command: 'socket fix --dry-run',
    canRun: true,
    tips: [
      'Interactive mode guides you through each fix',
      '--auto applies safe fixes automatically',
      '--dry-run shows what would change without applying',
    ],
    nextPrompt: 'See what fixes would be applied?',
  },
  {
    title: '📦 Step 6: Secure Package Installation',
    description: 'Use Socket wrappers instead of npm/yarn/pnpm for safer installs.',
    example: 'socket npm install express',
    tips: [
      'Blocks typosquatted packages',
      'Warns about risky dependencies',
      'Works exactly like npm/yarn/pnpm',
      'Prevents supply chain attacks',
    ],
    nextPrompt: 'Continue to optimization features?',
  },
  {
    title: '⚡ Step 7: Dependency Optimization',
    description: 'Socket can help optimize your dependencies for security and performance.',
    example: 'socket optimize .',
    command: 'socket optimize . --dry-run',
    canRun: true,
    tips: [
      'Removes unused dependencies',
      'Updates to more secure versions',
      'Pins versions for reproducibility',
    ],
    nextPrompt: 'Preview optimization suggestions?',
  },
  {
    title: '📴 Step 8: Offline Mode',
    description: 'Socket CLI works offline using cached data!',
    example: 'SOCKET_OFFLINE=1 socket package score react',
    tips: [
      'API responses are cached with TTL',
      'Set SOCKET_OFFLINE=1 to force offline mode',
      'Great for CI/CD and airplane coding',
      'Use `socket cache clear` to reset cache',
    ],
  },
  {
    title: '🎯 Step 9: CI/CD Integration',
    description: 'Socket integrates seamlessly with your CI/CD pipeline.',
    example: 'socket ci',
    tips: [
      'Fails builds on critical vulnerabilities',
      'Generates security reports',
      'Supports GitHub Actions, GitLab CI, etc.',
      'Use --json for machine-readable output',
    ],
  },
  {
    title: '🏢 Step 10: Organization Management',
    description: 'Manage your organization\'s security policies and repositories.',
    example: 'socket org list',
    command: 'socket org list',
    canRun: true,
    tips: [
      'View organization dependencies and quota',
      'Manage security and license policies',
      'Track repository security status',
    ],
  },
  {
    title: '🎉 Tour Complete!',
    description: `Congratulations! You've learned the key features of Socket CLI.

Here's a quick reference of what we covered:
• Authentication: socket login
• Scanning: socket scan create .
• Package checks: socket package score <name>
• Natural language: socket ask "<question>"
• Fixing: socket fix interactive
• Secure installs: socket npm install
• Optimization: socket optimize .
• Offline mode: SOCKET_OFFLINE=1
• CI/CD: socket ci
• Organizations: socket org list`,
    tips: [
      'Run `socket --help` for the interactive help menu',
      'Run `socket --help=quick` for a quick start guide',
      'Visit https://socket.dev/docs for full documentation',
    ],
  },
]

/**
 * Run a command and show its output
 */
async function runCommand(command: string): Promise<boolean> {
  return await new Promise((resolve) => {
    logger.log(colors.dim(`\n$ ${command}`))
    const child = spawn(command, [], {
      shell: true,
      stdio: 'inherit',
    })

    child.on('error', (err) => {
      logger.error(`Failed to run command: ${err.message}`)
      resolve(false)
    })

    child.on('exit', (code) => {
      resolve(code === 0)
    })
  })
}

/**
 * Check if we're in a project directory
 */
function isInProject(): boolean {
  return existsSync('package.json') ||
         existsSync('pyproject.toml') ||
         existsSync('requirements.txt') ||
         existsSync('Cargo.toml')
}

/**
 * Run the interactive tour
 */
export async function runInteractiveTour(): Promise<void> {
  logger.log('')
  logger.log(colors.bold(colors.cyan('🎯 Socket CLI Interactive Tour')))
  logger.log('')

  if (!isInteractive()) {
    logger.log('This tour requires an interactive terminal.')
    logger.log('Please run in a terminal that supports interaction.')
    return
  }

  const rl = readline.createInterface({ input: stdin, output: stdout })

  try {
    let userQuit = false
    for (let i = 0; i < tourSteps.length; i++) {
      const step = tourSteps[i]
      // Safety check
      if (!step) {continue}

      const stepNumber = i > 0 && i < tourSteps.length - 1 ? `Step ${i}/${tourSteps.length - 2}: ` : ''

      // Clear previous content with spacing
      if (i > 0) {logger.log('')}

      // Show step title
      logger.log(colors.bold(colors.cyan(`${stepNumber}${step.title}`)))
      logger.log('')

      // Show description
      logger.log(step.description)
      logger.log('')

      // Show example if available
      if (step.example) {
        logger.log(colors.bold('Example command:'))
        logger.log(colors.green(`  ${step.example}`))
        logger.log('')
      }

      // Show tips
      if (step.tips && step.tips.length > 0) {
        logger.log(colors.bold('💡 Tips:'))
        for (const tip of step.tips) {
          logger.log(colors.gray(`  • ${tip}`))
        }
        logger.log('')
      }

      // Handle interactive elements
      const prompt = step.nextPrompt || 'Press Enter to continue (or q to quit)'
      // eslint-disable-next-line no-await-in-loop
      const answer = await rl.question(colors.cyan(`${prompt} `))

      if (answer.toLowerCase() === 'q' || answer.toLowerCase() === 'quit') {
        logger.log(colors.gray('\nTour ended. You can restart anytime with: socket --tour'))
        userQuit = true
        break
      }

      // Run command if available and user agrees
      if (step.command && step.canRun) {
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes' || answer === '') {
          // Check if we're in a project directory for scan/fix commands
          if ((step.command.includes('scan') || step.command.includes('fix') || step.command.includes('optimize')) && !isInProject()) {
            logger.log(colors.yellow('\n⚠️  This command works best in a project directory with package.json'))
            logger.log(colors.gray('Skipping command execution...'))
          } else {
            // eslint-disable-next-line no-await-in-loop
            await runCommand(step.command)
          }
        }
      }
    }

    if (!userQuit) {
      logger.log('')
      logger.log(colors.green('✨ Thanks for taking the Socket CLI tour!'))
      logger.log('')
      logger.log('Next steps:')
      logger.log('  • Try scanning your project: ' + colors.cyan('socket scan create .'))
      logger.log('  • Check a package: ' + colors.cyan('socket package score <package-name>'))
      logger.log('  • Get help anytime: ' + colors.cyan('socket --help'))
      logger.log('')
    }
  } catch (error) {
    logger.error('Tour interrupted')
  } finally {
    rl.close()
  }
}

/**
 * Show non-interactive tour summary
 */
export function showTourSummary(): void {
  logger.log(colors.bold(colors.cyan('🎯 Socket CLI Tour - Quick Overview')))
  logger.log('')
  logger.log('The interactive tour covers:')
  logger.log('')

  const topics = [
    '1. Authentication (socket login)',
    '2. Scanning for vulnerabilities (socket scan)',
    '3. Checking package safety (socket package score)',
    '4. Natural language interface (socket ask)',
    '5. Fixing vulnerabilities (socket fix)',
    '6. Secure package installation (socket npm/yarn/pnpm)',
    '7. Dependency optimization (socket optimize)',
    '8. Offline mode (SOCKET_OFFLINE=1)',
    '9. CI/CD integration (socket ci)',
    '10. Organization management (socket org)',
  ]

  for (const topic of topics) {
    logger.log(`  ${topic}`)
  }

  logger.log('')
  logger.log(colors.gray('Run in an interactive terminal to take the full tour.'))
  logger.log(colors.gray('Or try: socket --help=quick for a quick start guide.'))
}