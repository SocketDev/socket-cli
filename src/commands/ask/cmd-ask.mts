/** @fileoverview Natural language command interface for Socket CLI. */

import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm } from '@socketsecurity/registry/lib/prompts'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type {
  CliSubcommand,
} from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'ask'

const description = 'Natural language interface - describe what you want to do'

const hidden = false

interface CommandIntent {
  command: string[]
  explanation: string
  confidence: number
}

// Command patterns for natural language processing
const INTENT_PATTERNS: Array<{
  patterns: RegExp[]
  getCommand: (match: RegExpMatchArray) => string[]
  explanation: string
}> = [
  // Scanning intents
  {
    patterns: [
      /scan\s+(this\s+)?(?:project|directory|folder|repo)?/i,
      /check\s+(?:for\s+)?(?:vulnerabilities|issues|problems)/i,
      /analyze\s+(?:this\s+)?(?:project|code|dependencies)/i,
    ],
    getCommand: () => ['scan', 'create', '.'],
    explanation: 'Create a security scan of the current directory',
  },
  {
    patterns: [
      /scan\s+(?:only\s+)?(?:production|prod)\s+(?:dependencies|deps|packages)?/i,
      /check\s+prod(?:uction)?\s+(?:dependencies|deps)?/i,
    ],
    getCommand: () => ['scan', 'create', '.', '--prod'],
    explanation: 'Scan only production dependencies',
  },
  {
    patterns: [
      /(?:show|list|view)\s+(?:me\s+)?(?:critical|high|severe)\s+(?:vulnerabilities|issues|problems)/i,
      /what\s+(?:are\s+)?(?:the\s+)?critical\s+(?:issues|problems|vulnerabilities)/i,
    ],
    getCommand: () => ['scan', 'report', '--severity=critical'],
    explanation: 'Show critical vulnerabilities from the last scan',
  },

  // Fix intents
  {
    patterns: [
      /fix\s+(?:all\s+)?(?:the\s+)?(?:vulnerabilities|issues|problems)/i,
      /repair\s+(?:the\s+)?(?:security\s+)?issues/i,
      /patch\s+(?:all\s+)?vulnerabilities/i,
    ],
    getCommand: () => ['fix', 'interactive'],
    explanation: 'Start interactive fix mode for vulnerabilities',
  },
  {
    patterns: [
      /(?:auto|automatically)\s+fix\s+(?:safe\s+)?(?:issues|problems|vulnerabilities)/i,
      /apply\s+(?:all\s+)?safe\s+fixes/i,
    ],
    getCommand: () => ['fix', 'interactive', '--auto'],
    explanation: 'Automatically apply safe fixes',
  },
  {
    patterns: [
      /update\s+(?:all\s+)?(?:vulnerable|outdated)\s+(?:packages|dependencies|deps)/i,
      /upgrade\s+(?:to\s+)?(?:secure|safe)\s+versions/i,
    ],
    getCommand: () => ['fix', '--pin'],
    explanation: 'Update vulnerable packages to safe versions',
  },

  // Optimization intents
  {
    patterns: [
      /optimize\s+(?:my\s+)?(?:dependencies|packages|deps)/i,
      /remove\s+(?:unused|unnecessary)\s+(?:dependencies|packages)/i,
      /clean\s+(?:up\s+)?(?:dependencies|packages)/i,
    ],
    getCommand: () => ['optimize', '.'],
    explanation: 'Optimize and clean up dependencies',
  },
  {
    patterns: [
      /(?:show|preview)\s+(?:what\s+)?(?:would\s+be\s+)?optimized/i,
      /optimize\s+dry[\s-]?run/i,
    ],
    getCommand: () => ['optimize', '.', '--dry-run'],
    explanation: 'Preview optimization changes without applying them',
  },

  // Repository management
  {
    patterns: [
      /(?:list|show)\s+(?:my\s+)?(?:repos|repositories)/i,
      /what\s+(?:repos|repositories)\s+(?:do\s+)?(?:I\s+)?have/i,
    ],
    getCommand: () => ['repos', 'list'],
    explanation: 'List all repositories in your organization',
  },
  {
    patterns: [
      /(?:create|add|setup)\s+(?:a\s+)?(?:new\s+)?repo(?:sitory)?\s+(?:called\s+|named\s+)?([a-zA-Z0-9-_]+)/i,
    ],
    getCommand: (match) => ['repos', 'create', match[1] || 'new-repo'],
    explanation: 'Create a new repository',
  },

  // Package information
  {
    patterns: [
      /(?:check|analyze|score)\s+(?:the\s+)?(?:package\s+)?([a-zA-Z0-9@/-]+)/i,
      /(?:is\s+)?([a-zA-Z0-9@/-]+)\s+(?:safe|secure)/i,
    ],
    getCommand: (match) => ['package', 'score', match[1] || 'package'],
    explanation: 'Get security score for a package',
  },

  // Authentication
  {
    patterns: [
      /(?:log\s*in|login|authenticate|sign\s*in)/i,
      /connect\s+(?:to\s+)?(?:my\s+)?(?:socket\s+)?account/i,
    ],
    getCommand: () => ['login'],
    explanation: 'Log in to your Socket account',
  },
  {
    patterns: [
      /(?:log\s*out|logout|sign\s*out)/i,
      /disconnect/i,
    ],
    getCommand: () => ['logout'],
    explanation: 'Log out from Socket',
  },

  // Help intents
  {
    patterns: [
      /(?:help|how)\s+(?:do\s+I\s+)?(?:use|work\s+with)\s+([a-zA-Z]+)/i,
      /(?:what\s+does|explain)\s+([a-zA-Z]+)\s+(?:do|command)?/i,
    ],
    getCommand: (match) => [match[1] || 'help', '--help'],
    explanation: 'Show help for a command',
  },

  // Configuration
  {
    patterns: [
      /(?:set|change|update)\s+(?:my\s+)?(?:default\s+)?org(?:anization)?\s+(?:to\s+)?([a-zA-Z0-9-_]+)/i,
    ],
    getCommand: (match) => ['config', 'set', 'defaultOrg', match[1] || 'org'],
    explanation: 'Set default organization',
  },
  {
    patterns: [
      /(?:show|list|view)\s+(?:my\s+)?(?:config|configuration|settings)/i,
    ],
    getCommand: () => ['config', 'list'],
    explanation: 'Show current configuration',
  },

  // CI/CD intents
  {
    patterns: [
      /(?:setup|configure)\s+(?:for\s+)?(?:github|ci|continuous\s+integration)/i,
      /integrate\s+(?:with\s+)?github/i,
    ],
    getCommand: () => ['ci'],
    explanation: 'Set up CI/CD integration',
  },

  // Reachability analysis
  {
    patterns: [
      /(?:check|analyze)\s+(?:code\s+)?reachability/i,
      /(?:is\s+)?(?:vulnerable\s+)?code\s+(?:actually\s+)?reachable/i,
    ],
    getCommand: () => ['scan', 'create', '.', '--reach'],
    explanation: 'Perform reachability analysis on vulnerabilities',
  },
]

function parseNaturalLanguage(input: string): CommandIntent | null {
  const normalizedInput = input.trim().toLowerCase()

  // Find matching intent
  for (const intent of INTENT_PATTERNS) {
    for (const pattern of intent.patterns) {
      const match = normalizedInput.match(pattern)
      if (match) {
        return {
          command: intent.getCommand(match),
          explanation: intent.explanation,
          confidence: calculateConfidence(input, pattern),
        }
      }
    }
  }

  // Fallback: Try to extract command-like words
  const commandWords = ['scan', 'fix', 'optimize', 'package', 'repos', 'login', 'config']
  for (const word of commandWords) {
    if (normalizedInput.includes(word)) {
      return {
        command: [word, '--help'],
        explanation: `Show help for ${word} command`,
        confidence: 0.3,
      }
    }
  }

  return null
}

function calculateConfidence(input: string, pattern: RegExp): number {
  // Simple confidence calculation based on how well the pattern matches
  const match = input.match(pattern)
  if (!match) {return 0}

  const matchLength = match[0].length
  const inputLength = input.length
  const coverage = matchLength / inputLength

  // Boost confidence for exact or near-exact matches
  if (coverage > 0.8) {return 0.9}
  if (coverage > 0.6) {return 0.7}
  return 0.5
}

async function suggestAlternatives(input: string): Promise<string[]> {
  const suggestions: string[] = []

  // Suggest based on keywords
  if (input.includes('security') || input.includes('vulnerable')) {
    suggestions.push('scan create .', 'fix interactive', 'package score <package>')
  }
  if (input.includes('update') || input.includes('upgrade')) {
    suggestions.push('fix --pin', 'optimize .', 'npm update')
  }
  if (input.includes('install')) {
    suggestions.push('npm install <package>', 'npx <package>')
  }

  return suggestions
}

const askHelp = (command: string) => `
  Usage
    $ ${command} <natural-language-query>

  Natural Language Examples
    $ ${command} "scan this project for vulnerabilities"
    $ ${command} "fix all critical issues"
    $ ${command} "show me production vulnerabilities"
    $ ${command} "optimize my dependencies"
    $ ${command} "is lodash safe to use"

  Options
    --execute, -e    Execute the command directly
    --explain        Show detailed explanation

  Examples
    $ ${command} "what vulnerabilities do I have?"
    $ ${command} "fix critical issues" --execute
`

export const cmdAsk: CliSubcommand = {
  description,
  hidden,
  async run(
    argv: readonly string[],
    importMeta: ImportMeta,
    { parentName }: { parentName: string },
  ): Promise<void> {
    const flags = {
      ...commonFlags,
      execute: {
        type: 'boolean' as const,
        default: false,
        shortFlag: 'e',
        description: 'Execute the command directly without confirmation',
      },
      explain: {
        type: 'boolean' as const,
        default: false,
        description: 'Show detailed explanation of the command',
      },
    }

    const cli = meowOrExit({
      argv,
      config: {
        commandName: CMD_NAME,
        description,
        hidden,
        flags,
        help: () => askHelp(`${parentName} ${CMD_NAME}`),
      },
      parentName,
      importMeta,
    })

    const { execute, explain } = cli.flags as { execute: boolean; explain: boolean }

    // Join all input as the natural language query
    const query = cli.input.join(' ')

    if (!query) {
      logger.error('Please provide a natural language query')
      logger.log('\nExamples:')
      logger.log('  socket ask "scan for vulnerabilities"')
      logger.log('  socket ask "fix critical issues"')
      logger.log('  socket ask "is express safe"')
      return
    }

    // Parse the natural language input
    const intent = parseNaturalLanguage(query)

    if (!intent) {
      logger.log('')
      logger.warn(`I couldn't understand: "${query}"`)
      logger.log('')

      const alternatives = await suggestAlternatives(query)
      if (alternatives.length > 0) {
        logger.log('Here are some related commands:')
        for (const alt of alternatives) {
          logger.log(`  socket ${alt}`)
        }
      } else {
        logger.log('Try one of these:')
        logger.log('  socket scan create .')
        logger.log('  socket fix interactive')
        logger.log('  socket optimize .')
        logger.log('  socket --help')
      }
      return
    }

    // Display the interpreted command cleanly
    const commandStr = `socket ${intent.command.join(' ')}`

    logger.log('')
    logger.log(colors.cyan('Command:') + ` ${colors.bold(commandStr)}`)

    if (explain || intent.confidence < 0.7) {
      logger.log(colors.gray(`This will: ${intent.explanation}`))
    }

    if (intent.confidence < 0.5) {
      logger.log('')
      logger.warn('Low confidence in this translation')
      logger.log('Please verify this is what you intended')
    }

    // Execute or confirm
    let shouldExecute = false

    if (execute && intent.confidence >= 0.7) {
      shouldExecute = true
    } else if (!execute) {
      // Prompt for confirmation
      logger.log('')
      const confirmed = await confirm({
        message: 'Execute this command?',
        default: true,
      })
      shouldExecute = confirmed === true
    } else {
      logger.log('')
      logger.warn('Confidence too low for auto-execution')
      const confirmed = await confirm({
        message: 'Execute this command anyway?',
        default: false,
      })
      shouldExecute = confirmed === true
    }

    if (shouldExecute) {
      logger.log('')

      // Execute the actual command
      const result = await spawn('socket', intent.command, {
        stdio: 'inherit',
        cwd: process.cwd(),
      })

      process.exitCode = result.code || 0
    } else {
      logger.log('')
      logger.log(colors.gray('Command not executed'))
    }
  },
}