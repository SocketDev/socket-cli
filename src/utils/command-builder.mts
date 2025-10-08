/** @fileoverview Command builder to DRY out repetitive cmd-*.mts command definitions */

import { meowOrExit } from './meow-with-subcommands.mts'
import { commonFlags, outputFlags } from '../flags.mts'
import { logger } from '@socketsecurity/registry/lib/logger'

import type {
  CliCommandConfig,
  CliSubcommand,
  MeowFlags,
} from './meow-with-subcommands.mts'

/**
 * Options for building a CLI command
 */
export interface CommandBuilderOptions {
  name: string
  description: string
  hidden?: boolean
  args?: string
  flags?: MeowFlags
  includeCommonFlags?: boolean
  includeOutputFlags?: boolean
  handler: (args: {
    input: string[]
    flags: any
    cli: any
  }) => Promise<void>
  examples?: Array<{ command: string; description?: string }>
  usage?: string
  helpText?: string
}

/**
 * Build a standardized CLI subcommand
 */
export function buildCommand(options: CommandBuilderOptions): CliSubcommand {
  const {
    name,
    description,
    hidden = false,
    args = '',
    flags = {},
    includeCommonFlags = true,
    includeOutputFlags = false,
    handler,
    examples = [],
    usage,
    helpText,
  } = options

  // Combine flags based on options
  const combinedFlags: MeowFlags = {
    ...(includeCommonFlags ? commonFlags : {}),
    ...(includeOutputFlags ? outputFlags : {}),
    ...flags,
  }

  return {
    description,
    hidden,
    async run(argv: readonly string[], importMeta: ImportMeta, parentName: string) {
      const config: CliCommandConfig = {
        args,
        flags: combinedFlags,
        help: helpText
          ? () => helpText
          : (command, config) => {
              const lines = [`Usage\n  $ ${command} ${args}`.trim()]

              if (examples.length > 0) {
                lines.push('\nExamples')
                for (const ex of examples) {
                  lines.push(`  $ ${command} ${ex.command}`)
                  if (ex.description) {
                    lines.push(`    ${ex.description}`)
                  }
                }
              }

              if (usage) {
                lines.push(`\n${usage}`)
              }

              lines.push('\nOptions')
              // Auto-generate options from flags
              for (const [key, flag] of Object.entries(combinedFlags)) {
                if (!flag || typeof flag !== 'object') continue
                const shortFlag = 'shortFlag' in flag ? `-${flag.shortFlag}, ` : ''
                const flagName = key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())
                lines.push(`  ${shortFlag}--${flagName}`)
                if ('description' in flag && flag.description) {
                  lines.push(`    ${flag.description}`)
                }
              }

              return lines.join('\n')
            },
      }

      const cli = meowOrExit({ argv, config, parentName, importMeta })

      await handler({
        input: cli.input,
        flags: cli.flags,
        cli,
      })
    },
  }
}

/**
 * Build a parent command with subcommands
 */
export interface ParentCommandOptions {
  name: string
  description: string
  hidden?: boolean
  subcommands: Record<string, CliSubcommand>
  defaultSubcommand?: string
}

export function buildParentCommand(options: ParentCommandOptions): CliSubcommand {
  const { name, description, hidden = false, subcommands, defaultSubcommand } = options

  return {
    description,
    hidden,
    subcommands,
    defaultSubcommand,
    async run(argv: readonly string[], importMeta: ImportMeta, parentName: string) {
      // This is typically handled by meowWithSubcommands
      // but we can provide a fallback
      logger.log(`Available subcommands for ${name}:`)
      for (const [key, cmd] of Object.entries(subcommands)) {
        if (!cmd.hidden) {
          logger.log(`  ${key} - ${cmd.description}`)
        }
      }
    },
  }
}

/**
 * Common command patterns
 */
export const commandPatterns = {
  /**
   * Build a standard list command
   */
  list: (entity: string, handler: any) =>
    buildCommand({
      name: `list-${entity}`,
      description: `List all ${entity}`,
      includeOutputFlags: true,
      handler,
      examples: [
        { command: '', description: `List all ${entity}` },
        { command: '--json', description: 'Output as JSON' },
      ],
    }),

  /**
   * Build a standard create command
   */
  create: (entity: string, args: string, handler: any) =>
    buildCommand({
      name: `create-${entity}`,
      description: `Create a new ${entity}`,
      args,
      includeOutputFlags: true,
      handler,
      examples: [{ command: args, description: `Create a new ${entity}` }],
    }),

  /**
   * Build a standard delete command
   */
  delete: (entity: string, args: string, handler: any) =>
    buildCommand({
      name: `delete-${entity}`,
      description: `Delete a ${entity}`,
      args,
      handler,
      examples: [{ command: args, description: `Delete the ${entity}` }],
    }),

  /**
   * Build a standard view command
   */
  view: (entity: string, args: string, handler: any) =>
    buildCommand({
      name: `view-${entity}`,
      description: `View details of a ${entity}`,
      args,
      includeOutputFlags: true,
      handler,
      examples: [{ command: args, description: `View ${entity} details` }],
    }),
}

/**
 * Standard error handlers
 */
export const errorHandlers = {
  /**
   * Handle missing required argument
   */
  missingArg: (argName: string, example?: string) => {
    logger.error(`Missing required argument: ${argName}`)
    if (example) {
      logger.log(`Example: ${example}`)
    }
    process.exitCode = 1
  },

  /**
   * Handle API error
   */
  apiError: (error: any, operation: string) => {
    logger.error(`Failed to ${operation}`)
    if (error.message) {
      logger.error(error.message)
    }
    process.exitCode = 1
  },

  /**
   * Handle validation error
   */
  validationError: (message: string) => {
    logger.error(`Validation error: ${message}`)
    process.exitCode = 1
  },
}