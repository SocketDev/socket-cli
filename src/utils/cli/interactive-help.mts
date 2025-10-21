/** @fileoverview Interactive help system for Socket CLI */

/* eslint-disable no-await-in-loop -- Sequential user interactions required */

import { stdin, stdout } from 'node:process'
import readline from 'node:readline/promises'
import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { logger } from '@socketsecurity/lib/logger'
import colors from 'yoctocolors-cjs'

interface HelpCategory {
  title: string
  key: string
  icon: string
  description: string
  content: () => void
}

const helpCategories: HelpCategory[] = [
  {
    title: 'Security Scanning',
    key: 'scan',
    icon: '🔍',
    description: 'Scan projects for vulnerabilities',
    content: () => {
      logger.log(colors.cyan('\n📦 Security Scanning Commands\n'))
      logger.log('  socket scan create [path]    Create a security scan')
      logger.log('  socket scan list             List recent scans')
      logger.log('  socket scan view <id>        View scan details')
      logger.log('  socket scan report           Generate scan report')
      logger.log('')
      logger.log(colors.gray('Options:'))
      logger.log(
        '  --prod                       Scan production dependencies only',
      )
      logger.log('  --reach                      Enable reachability analysis')
      logger.log('  --json                       Output as JSON')
      logger.log('')
      logger.log(colors.gray('Examples:'))
      logger.log('  socket scan create .')
      logger.log('  socket scan create . --prod --reach')
      logger.log('  socket scan list --limit=10')
    },
  },
  {
    title: 'Fix & Patch',
    key: 'fix',
    icon: '🔧',
    description: 'Fix vulnerabilities and apply patches',
    content: () => {
      logger.log(colors.cyan('\n🔧 Fix & Patch Commands\n'))
      logger.log('  socket fix                   Auto-fix vulnerabilities')
      logger.log('  socket fix interactive       Interactive guided fixing')
      logger.log('  socket patch                 Apply security patches')
      logger.log('  socket optimize              Optimize dependencies')
      logger.log('')
      logger.log(colors.gray('Fix Options:'))
      logger.log(
        '  --dry-run                    Preview changes without applying',
      )
      logger.log('  --auto                       Auto-apply safe fixes')
      logger.log('  --severity=high              Minimum severity to fix')
      logger.log('  --pin                        Pin to exact versions')
      logger.log('')
      logger.log(colors.gray('Examples:'))
      logger.log('  socket fix --dry-run')
      logger.log('  socket fix interactive --auto')
      logger.log('  socket patch')
    },
  },
  {
    title: 'Package Managers',
    key: 'pm',
    icon: '📦',
    description: 'Enhanced package manager commands',
    content: () => {
      logger.log(colors.cyan('\n📦 Package Manager Wrappers\n'))
      logger.log('  socket npm [command]         Secure npm wrapper')
      logger.log('  socket npx [command]         Secure npx wrapper')
      logger.log('  socket yarn [command]        Secure yarn wrapper')
      logger.log('  socket pnpm [command]        Secure pnpm wrapper')
      logger.log('')
      logger.log(colors.gray('Features:'))
      logger.log('  • Blocks typosquatted packages')
      logger.log('  • Warns about risky dependencies')
      logger.log('  • Prevents supply chain attacks')
      logger.log('  • Maintains normal workflow')
      logger.log('')
      logger.log(colors.gray('Examples:'))
      logger.log('  socket npm install express')
      logger.log('  socket npx create-react-app my-app')
      logger.log('  socket yarn add lodash')
    },
  },
  {
    title: 'Package Analysis',
    key: 'pkg',
    icon: '📊',
    description: 'Analyze package security',
    content: () => {
      logger.log(colors.cyan('\n📊 Package Analysis Commands\n'))
      logger.log('  socket package score <pkg>   Get security score')
      logger.log('  socket package issues <pkg>  List security issues')
      logger.log('  socket package shallow <pkg> Quick security check')
      logger.log('')
      logger.log(colors.gray('Package Formats:'))
      logger.log('  lodash                       Latest version')
      logger.log('  lodash@4.17.21              Specific version')
      logger.log('  pypi/flask/2.0.0           Python package')
      logger.log('')
      logger.log(colors.gray('Examples:'))
      logger.log('  socket package score express')
      logger.log('  socket package issues react@18.0.0')
      logger.log('  socket ask "is lodash safe"')
    },
  },
  {
    title: 'Organizations & Repos',
    key: 'org',
    icon: '🏢',
    description: 'Manage organizations and repositories',
    content: () => {
      logger.log(colors.cyan('\n🏢 Organization & Repository Commands\n'))
      logger.log('')
      logger.log(colors.bold('Organizations:'))
      logger.log('  socket org list              List your organizations')
      logger.log('  socket org dependencies      View org dependencies')
      logger.log('  socket org quota             Check usage quota')
      logger.log('  socket org policy            View security policies')
      logger.log('')
      logger.log(colors.bold('Repositories:'))
      logger.log('  socket repo list             List repositories')
      logger.log('  socket repo create <name>    Create repository')
      logger.log('  socket repo view <name>      View repository details')
      logger.log('')
      logger.log(colors.gray('Examples:'))
      logger.log('  socket org list --json')
      logger.log('  socket repo create my-project')
    },
  },
  {
    title: 'Configuration',
    key: 'config',
    icon: '⚙️',
    description: 'Settings and environment variables',
    content: () => {
      logger.log(colors.cyan('\n⚙️ Configuration\n'))
      logger.log('')
      logger.log(colors.bold('Commands:'))
      logger.log('  socket login                 Authenticate with Socket')
      logger.log('  socket config list           Show configuration')
      logger.log('  socket config set <key> <val> Set config value')
      logger.log('  socket whoami                Show current user')
      logger.log('')
      logger.log(colors.bold('Environment Variables:'))
      logger.log('  SOCKET_CLI_API_TOKEN         API authentication token')
      logger.log('  SOCKET_OFFLINE=1             Enable offline mode')
      logger.log('  SOCKET_VERBOSE=1             Show verbose output')
      logger.log('  SOCKET_CLI_API_PROXY         HTTP proxy URL')
      logger.log('  SOCKET_CLI_CACHE_ENABLED=1   Enable API caching')
      logger.log('')
      logger.log(colors.bold('Config Keys:'))
      logger.log('  defaultOrg                   Default organization')
      logger.log('  apiToken                     Stored API token')
      logger.log('')
      logger.log(colors.gray('Examples:'))
      logger.log('  socket config set defaultOrg my-org')
      logger.log('  SOCKET_OFFLINE=1 socket scan list')
    },
  },
  {
    title: 'Natural Language',
    key: 'ask',
    icon: '💬',
    description: 'Use plain English commands',
    content: () => {
      logger.log(colors.cyan('\n💬 Natural Language Interface\n'))
      logger.log('')
      logger.log('  socket ask "<question>"      Ask in plain English')
      logger.log('')
      logger.log(colors.gray('Examples:'))
      logger.log('  socket ask "scan for vulnerabilities"')
      logger.log('  socket ask "fix critical issues"')
      logger.log('  socket ask "is express safe to use"')
      logger.log('  socket ask "show production vulnerabilities"')
      logger.log('  socket ask "optimize my dependencies"')
      logger.log('')
      logger.log(colors.gray('Options:'))
      logger.log('  --execute, -e                Execute the command directly')
      logger.log('  --explain                    Show detailed explanation')
      logger.log('')
      logger.log(colors.gray('Tips:'))
      logger.log('  • Be specific about what you want')
      logger.log('  • Mention "production" or "dev" to filter')
      logger.log('  • Use severity levels: critical, high, medium, low')
      logger.log('  • Say "dry run" to preview changes')
    },
  },
  {
    title: 'All Commands',
    key: 'all',
    icon: '📚',
    description: 'Show complete command list',
    content: () => {
      logger.log(colors.cyan('\n📚 All Socket CLI Commands\n'))

      const commands = [
        { cmd: 'analytics', desc: 'View security analytics' },
        { cmd: 'ask', desc: 'Natural language interface' },
        { cmd: 'audit-log', desc: 'View audit logs' },
        { cmd: 'ci', desc: 'CI/CD integration' },
        { cmd: 'config', desc: 'Manage configuration' },
        { cmd: 'dependencies', desc: 'View dependencies' },
        { cmd: 'fix', desc: 'Fix vulnerabilities' },
        { cmd: 'json', desc: 'Convert SBOM formats' },
        { cmd: 'license', desc: 'License policy' },
        { cmd: 'login/logout', desc: 'Authentication' },
        { cmd: 'manifest', desc: 'Generate manifests' },
        { cmd: 'npm/npx', desc: 'Secure npm wrapper' },
        { cmd: 'optimize', desc: 'Optimize dependencies' },
        { cmd: 'organization', desc: 'Manage organizations' },
        { cmd: 'package', desc: 'Analyze packages' },
        { cmd: 'patch', desc: 'Apply patches' },
        { cmd: 'pnpm', desc: 'Secure pnpm wrapper' },
        { cmd: 'repository', desc: 'Manage repositories' },
        { cmd: 'scan', desc: 'Security scanning' },
        { cmd: 'security', desc: 'Security policy' },
        { cmd: 'threat-feed', desc: 'Threat intelligence' },
        { cmd: 'whoami', desc: 'Current user info' },
        { cmd: 'wrapper', desc: 'CDN wrapper' },
        { cmd: 'yarn', desc: 'Secure yarn wrapper' },
      ]

      for (const { cmd, desc } of commands) {
        logger.log(`  ${colors.bold(cmd.padEnd(15))} ${desc}`)
      }

      logger.log('')
      logger.log(colors.gray('For detailed help on any command:'))
      logger.log('  socket <command> --help')
    },
  },
  {
    title: 'Quick Start',
    key: 'quick',
    icon: '🚀',
    description: 'Get started quickly',
    content: () => {
      logger.log(colors.cyan('\n🚀 Quick Start Guide\n'))
      logger.log(colors.bold('1. First-time setup:'))
      logger.log('   socket login                 # Authenticate')
      logger.log('   socket config auto            # Auto-configure')
      logger.log('')
      logger.log(colors.bold('2. Scan your project:'))
      logger.log('   socket scan create .          # Scan current directory')
      logger.log('   socket scan report            # View results')
      logger.log('')
      logger.log(colors.bold('3. Fix vulnerabilities:'))
      logger.log('   socket fix interactive        # Guided fixing')
      logger.log('   socket fix --auto            # Auto-fix safe issues')
      logger.log('')
      logger.log(colors.bold('4. Secure installs:'))
      logger.log('   socket npm install           # Use instead of npm')
      logger.log('   socket npx create-app        # Use instead of npx')
      logger.log('')
      logger.log(colors.bold('5. Check packages:'))
      logger.log('   socket package score lodash  # Check package safety')
      logger.log('   socket ask "is X safe"       # Natural language query')
    },
  },
]

export async function showInteractiveHelp(): Promise<void> {
  // Show header
  logger.log('')
  logger.log(
    colors.bold(colors.cyan('⚡ Socket CLI - Secure your supply chain')),
  )
  logger.log('')

  // If not interactive, show categories and exit
  if (!isInteractive()) {
    logger.log('What can I help you with?\n')
    showCategoryList()
    logger.log('')
    logger.log(
      colors.gray('Run with an interactive terminal to select a category'),
    )
    logger.log(colors.gray('Or use: socket --help=<category>'))
    logger.log(
      colors.gray(
        'Categories: scan, fix, pm, pkg, org, config, ask, all, quick',
      ),
    )
    return
  }

  // Interactive mode
  const rl = readline.createInterface({ input: stdin, output: stdout })

  try {
    while (true) {
      logger.log(colors.bold('What can I help you with?\n'))
      showCategoryList()
      logger.log('')

      const answer = await rl.question(
        colors.cyan('Enter number or press Enter to exit: '),
      )

      if (!answer || answer.toLowerCase() === 'q') {
        logger.log(colors.gray('\nFor more info: socket <command> --help'))
        break
      }

      const num = Number.parseInt(answer, 10)
      if (num >= 1 && num <= helpCategories.length) {
        const category = helpCategories[num - 1]
        if (category) {
          category.content()
        }
        logger.log('')

        const again = await rl.question(
          colors.gray('Press Enter to continue or q to quit: '),
        )
        if (again.toLowerCase() === 'q') {
          break
        }
        logger.log('')
      } else {
        logger.log(colors.red('Invalid selection. Please try again.\n'))
      }
    }
  } finally {
    rl.close()
  }
}

function showCategoryList(): void {
  helpCategories.forEach((cat, index) => {
    const num = colors.dim(`[${index + 1}]`)
    logger.log(`  ${num} ${cat.icon}  ${colors.bold(cat.title)}`)
    logger.log(`      ${colors.gray(cat.description)}`)
  })
}

/**
 * Show help for a specific category (non-interactive)
 */
export function showCategoryHelp(category: string): boolean {
  const cat = helpCategories.find(
    c =>
      c.key === category ||
      c.title.toLowerCase().includes(category.toLowerCase()),
  )

  if (cat) {
    cat.content()
    return true
  }

  // Check for special shortcuts
  const shortcuts: Record<string, string> = {
    scanning: 'scan',
    vulnerabilities: 'scan',
    fixing: 'fix',
    patches: 'fix',
    npm: 'pm',
    yarn: 'pm',
    pnpm: 'pm',
    packages: 'pkg',
    orgs: 'org',
    repos: 'org',
    settings: 'config',
    env: 'config',
    natural: 'ask',
    start: 'quick',
  }

  const shortcut = shortcuts[category.toLowerCase()]
  if (shortcut) {
    const cat = helpCategories.find(c => c.key === shortcut)
    if (cat) {
      cat.content()
      return true
    }
  }

  return false
}
