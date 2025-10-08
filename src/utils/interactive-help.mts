/** @fileoverview Interactive help system for Socket CLI */

import { stdin, stdout } from 'node:process'
import readline from 'node:readline/promises'

import colors from 'yoctocolors-cjs'

import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import type { Choice } from '@socketsecurity/registry/lib/prompts'

interface HelpCategory {
  title: string
  key: string
  description: string
  content: () => void
}

const helpCategories: HelpCategory[] = [
  {
    title: 'Security Scanning',
    key: 'scan',
    description: 'Scan projects for vulnerabilities and security issues',
    content: () => {
      logger.log(colors.cyan('\nSecurity Scanning Commands\n'))
      logger.log('  socket scan create [path]    Create a security scan')
      logger.log('  socket scan list             List recent scans')
      logger.log('  socket scan view <id>        View scan details')
      logger.log('  socket scan report           Generate scan report')
      logger.log('')
      logger.log(colors.bold('Options:'))
      logger.log('  --prod                       Scan production dependencies only')
      logger.log('  --reach                      Enable reachability analysis')
      logger.log('  --json                       Output as JSON')
      logger.log('')
      logger.log(colors.bold('Examples:'))
      logger.log('  socket scan create .')
      logger.log('  socket scan create . --prod --reach')
      logger.log('  socket scan list --limit=10')
    },
  },
  {
    title: 'Fix & Patch',
    key: 'fix',
    description: 'Auto-fix vulnerabilities and apply security patches',
    content: () => {
      logger.log(colors.cyan('\nFix & Patch Commands\n'))
      logger.log('  socket fix                   Auto-fix vulnerabilities')
      logger.log('  socket fix interactive       Interactive guided fixing')
      logger.log('  socket patch                 Apply security patches')
      logger.log('  socket optimize              Optimize dependencies')
      logger.log('')
      logger.log(colors.bold('Fix Options:'))
      logger.log('  --dry-run                    Preview changes without applying')
      logger.log('  --auto                       Auto-apply safe fixes')
      logger.log('  --severity=high              Minimum severity to fix')
      logger.log('  --pin                        Pin to exact versions')
      logger.log('')
      logger.log(colors.bold('Examples:'))
      logger.log('  socket fix --dry-run')
      logger.log('  socket fix interactive --auto')
      logger.log('  socket patch')
    },
  },
  {
    title: 'Package Managers',
    key: 'pm',
    description: 'Enhanced npm, npx, yarn, and pnpm wrappers',
    content: () => {
      logger.log(colors.cyan('\nPackage Manager Wrappers\n'))
      logger.log('  socket npm [command]         Secure npm wrapper')
      logger.log('  socket npx [command]         Secure npx wrapper')
      logger.log('  socket yarn [command]        Secure yarn wrapper')
      logger.log('  socket pnpm [command]        Secure pnpm wrapper')
      logger.log('')
      logger.log(colors.bold('Features:'))
      logger.log('  - Blocks typosquatted packages')
      logger.log('  - Warns about risky dependencies')
      logger.log('  - Prevents supply chain attacks')
      logger.log('  - Maintains normal workflow')
      logger.log('')
      logger.log(colors.bold('Examples:'))
      logger.log('  socket npm install express')
      logger.log('  socket npx create-react-app my-app')
      logger.log('  socket yarn add lodash')
    },
  },
  {
    title: 'Package Analysis',
    key: 'pkg',
    description: 'Analyze package security and get security scores',
    content: () => {
      logger.log(colors.cyan('\nPackage Analysis Commands\n'))
      logger.log('  socket package score <pkg>   Get security score')
      logger.log('  socket package issues <pkg>  List security issues')
      logger.log('  socket package shallow <pkg> Quick security check')
      logger.log('')
      logger.log(colors.bold('Package Formats:'))
      logger.log('  lodash                       Latest version')
      logger.log('  lodash@4.17.21              Specific version')
      logger.log('  pypi/flask/2.0.0           Python package')
      logger.log('')
      logger.log(colors.bold('Examples:'))
      logger.log('  socket package score express')
      logger.log('  socket package issues react@18.0.0')
      logger.log('  socket ask "is lodash safe"')
    },
  },
  {
    title: 'Organizations',
    key: 'org',
    description: 'Manage organizations and repositories',
    content: () => {
      logger.log(colors.cyan('\nOrganization & Repository Commands\n'))
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
      logger.log(colors.bold('Examples:'))
      logger.log('  socket org list --json')
      logger.log('  socket repo create my-project')
    },
  },
  {
    title: 'Configuration',
    key: 'config',
    description: 'CLI settings and configuration management',
    content: () => {
      logger.log(colors.cyan('\nConfiguration\n'))
      logger.log('')
      logger.log(colors.bold('Commands:'))
      logger.log('  socket login                 Authenticate with Socket')
      logger.log('  socket logout                Sign out of Socket')
      logger.log('  socket config list           Show configuration')
      logger.log('  socket config set <key> <val> Set config value')
      logger.log('  socket config get <key>      Get config value')
      logger.log('  socket config unset <key>    Remove config value')
      logger.log('  socket whoami                Show current user')
      logger.log('')
      logger.log(colors.bold('Config Keys:'))
      logger.log('  defaultOrg                   Default organization')
      logger.log('  apiToken                     Stored API token')
      logger.log('  apiBaseUrl                   API endpoint URL')
      logger.log('')
      logger.log(colors.bold('Examples:'))
      logger.log('  socket config set defaultOrg my-org')
      logger.log('  socket config list --json')
      logger.log('  socket config get apiToken')
    },
  },
  {
    title: 'Environment Variables',
    key: 'env',
    description: 'Environment variables for advanced configuration',
    content: () => {
      logger.log(colors.cyan('\nEnvironment Variables\n'))
      logger.log('')
      logger.log(colors.bold('Authentication:'))
      logger.log('  SOCKET_CLI_API_TOKEN         Set the Socket API token')
      logger.log('  SOCKET_CLI_NO_API_TOKEN      Disable API token usage')
      logger.log('')
      logger.log(colors.bold('Configuration:'))
      logger.log('  SOCKET_CLI_CONFIG            JSON stringified config object')
      logger.log('  SOCKET_CLI_ORG_SLUG          Specify organization slug')
      logger.log('')
      logger.log(colors.bold('Network & API:'))
      logger.log('  SOCKET_CLI_API_BASE_URL      Change API base URL')
      logger.log('  SOCKET_CLI_API_PROXY         HTTP proxy for API requests')
      logger.log('  SOCKET_CLI_API_TIMEOUT       API request timeout (ms)')
      logger.log('  SOCKET_CLI_GITHUB_API_URL    GitHub API base URL')
      logger.log('')
      logger.log(colors.bold('GitHub Integration:'))
      logger.log('  SOCKET_CLI_GITHUB_TOKEN      GitHub personal access token')
      logger.log('  GITHUB_TOKEN                 Alias for above')
      logger.log('  SOCKET_CLI_GIT_USER_EMAIL    Git user email for commits')
      logger.log('  SOCKET_CLI_GIT_USER_NAME     Git user name for commits')
      logger.log('')
      logger.log(colors.bold('Package Manager Wrappers:'))
      logger.log('  SOCKET_CLI_ACCEPT_RISKS      Accept wrapped npm/npx risks')
      logger.log('  SOCKET_CLI_VIEW_ALL_RISKS    View all wrapper risks')
      logger.log('  SOCKET_CLI_NPM_PATH          Absolute npm directory path')
      logger.log('')
      logger.log(colors.bold('Cache & Offline:'))
      logger.log('  SOCKET_OFFLINE=1             Enable offline mode')
      logger.log('  SOCKET_CLI_CACHE_ENABLED=1   Enable API caching')
      logger.log('  SOCKET_CACHE_DIR             Cache directory path')
      logger.log('')
      logger.log(colors.bold('Debug & Development:'))
      logger.log('  SOCKET_CLI_DEBUG             Enable debug logging')
      logger.log('  SOCKET_VERBOSE=1             Show verbose output')
      logger.log('  DEBUG                        NPM debug package pattern')
      logger.log('')
      logger.log(colors.bold('Examples:'))
      logger.log('  SOCKET_CLI_API_TOKEN=xxx socket scan create')
      logger.log('  SOCKET_OFFLINE=1 socket scan list')
      logger.log('  SOCKET_CLI_DEBUG=1 socket fix --dry-run')
    },
  },
  {
    title: 'Common Flags',
    key: 'flags',
    description: 'Global command-line flags and options',
    content: () => {
      logger.log(colors.cyan('\nCommon Flags & Options\n'))
      logger.log('')
      logger.log(colors.bold('Output Formats:'))
      logger.log('  --json                       Output results as JSON')
      logger.log('  --markdown                   Output results as Markdown')
      logger.log('  --csv                        Output results as CSV')
      logger.log('')
      logger.log(colors.bold('Control Options:'))
      logger.log('  --dry-run                    Preview changes without applying')
      logger.log('  --force                      Skip confirmations')
      logger.log('  --yes, -y                    Auto-confirm prompts')
      logger.log('')
      logger.log(colors.bold('Display Options:'))
      logger.log('  --no-banner                  Hide Socket ASCII header')
      logger.log('  --no-spinner                 Disable progress spinner')
      logger.log('  --compact-header             Use compact single-line header')
      logger.log('  --verbose                    Show detailed output')
      logger.log('  --quiet                      Minimal output')
      logger.log('')
      logger.log(colors.bold('Configuration:'))
      logger.log('  --org <name>                 Specify organization')
      logger.log('  --config <json>              Override config with JSON')
      logger.log('')
      logger.log(colors.bold('Help Options:'))
      logger.log('  --help, -h                   Show help for command')
      logger.log('  --help=<topic>               Show help for specific topic')
      logger.log('')
      logger.log(colors.bold('Examples:'))
      logger.log('  socket scan create --json')
      logger.log('  socket fix --dry-run --verbose')
      logger.log('  socket optimize --org my-org --force')
    },
  },
  {
    title: 'Natural Language',
    key: 'ask',
    description: 'Use plain English to interact with Socket',
    content: () => {
      logger.log(colors.cyan('\nNatural Language Interface\n'))
      logger.log('')
      logger.log('  socket ask "<question>"      Ask in plain English')
      logger.log('')
      logger.log(colors.bold('Examples:'))
      logger.log('  socket ask "scan for vulnerabilities"')
      logger.log('  socket ask "fix critical issues"')
      logger.log('  socket ask "is express safe to use"')
      logger.log('  socket ask "show production vulnerabilities"')
      logger.log('  socket ask "optimize my dependencies"')
      logger.log('')
      logger.log(colors.bold('Options:'))
      logger.log('  --execute, -e                Execute the command directly')
      logger.log('  --explain                    Show detailed explanation')
      logger.log('')
      logger.log(colors.bold('Tips:'))
      logger.log('  - Be specific about what you want')
      logger.log('  - Mention "production" or "dev" to filter')
      logger.log('  - Use severity levels: critical, high, medium, low')
      logger.log('  - Say "dry run" to preview changes')
    },
  },
  {
    title: 'All Commands',
    key: 'all',
    description: 'Complete list of all available commands',
    content: () => {
      logger.log(colors.cyan('\nAll Socket CLI Commands\n'))

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
    description: 'Get started with Socket CLI in minutes',
    content: () => {
      logger.log(colors.cyan('\nQuick Start Guide\n'))
      logger.log(colors.bold('New to Socket CLI?'))
      logger.log('')
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
  // Note: Banner is already shown by meow-with-subcommands before calling this function

  // If not interactive, show simple category list
  if (!isInteractive()) {
    logger.log(colors.bold('What can I help you with?'))
    logger.log('')
    logger.log('Help Topics:')
    for (const cat of helpCategories) {
      logger.log(`  ${colors.bold(cat.key.padEnd(10))} - ${cat.description}`)
    }
    logger.log('')
    logger.log(colors.gray('Use: socket --help=<topic>'))
    logger.log('')
    logger.log(colors.bold('💡 Tip: Run in an interactive terminal for a better experience'))
    return
  }

  // Interactive mode - use select prompt for clean category selection
  while (true) {
    const choices: Array<Choice<HelpCategory>> = helpCategories.map(cat => ({
      name: `${colors.bold(cat.title)} - ${colors.gray(cat.description)}`,
      value: cat,
      short: cat.title,
    }))

    // eslint-disable-next-line no-await-in-loop
    const selected = await select({
      message: 'What can I help you with?',
      choices: [
        ...choices,
        { name: colors.gray('Exit'), value: null as any, short: 'Exit' },
      ],
    })

    if (!selected) {
      logger.log(colors.gray('\nFor more info: socket <command> --help'))
      break
    }

    // Clear screen and show selected help
    console.clear()
    selected.content()
    logger.log('')

    // Ask to continue or exit
    const rl = readline.createInterface({ input: stdin, output: stdout })
    // eslint-disable-next-line no-await-in-loop
    await rl.question(colors.gray('Press Enter to continue...'))
    rl.close()

    console.clear()
  }
}

/**
 * Show help for a specific category (non-interactive)
 */
export function showCategoryHelp(category: string): boolean {
  // Note: Banner is already shown by meow-with-subcommands before calling this function

  const cat = helpCategories.find(c =>
    c.key === category ||
    c.title.toLowerCase().includes(category.toLowerCase())
  )

  if (cat) {
    cat.content()
    return true
  }

  // Check for special shortcuts
  const shortcuts: Record<string, string> = {
    'scanning': 'scan',
    'vulnerabilities': 'scan',
    'fixing': 'fix',
    'patches': 'fix',
    'npm': 'pm',
    'yarn': 'pm',
    'pnpm': 'pm',
    'packages': 'pkg',
    'orgs': 'org',
    'repos': 'org',
    'settings': 'config',
    'env': 'config',
    'natural': 'ask',
    'start': 'quick',
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