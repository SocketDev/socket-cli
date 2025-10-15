/** @fileoverview Help text generation for Socket CLI commands. Automatically generates formatted help output from CommandDefinition metadata. */

import type { CommandDefinition, FlagDefinition } from './registry-types.mjs'
import type { CommandRegistry } from './registry.mts'

/**
 * Generate help text for a command.
 *
 * @param command - Command definition to generate help for
 * @returns Formatted help text string
 */
export function generateCommandHelp(command: CommandDefinition): string {
  const lines: string[] = []

  // Name and description
  lines.push(`${command.name}`)
  lines.push('')
  lines.push(`  ${command.description}`)
  lines.push('')

  // Usage
  const flagsText = command.flags ? ' [options]' : ''
  lines.push(`Usage:`)
  lines.push(`  socket ${command.name}${flagsText}`)
  lines.push('')

  // Aliases
  if (command.aliases && command.aliases.length > 0) {
    lines.push(`Aliases:`)
    lines.push(`  ${command.aliases.join(', ')}`)
    lines.push('')
  }

  // Flags
  if (command.flags) {
    lines.push(`Options:`)
    const flagEntries = Object.entries(command.flags)

    for (const [name, def] of flagEntries) {
      const flagLine = formatFlag(name, def)
      lines.push(`  ${flagLine}`)
    }
    lines.push('')
  }

  // Examples
  if (command.examples && command.examples.length > 0) {
    lines.push(`Examples:`)
    for (const example of command.examples) {
      lines.push(`  ${example}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Format a flag definition for help output.
 *
 * @param name - Flag name
 * @param def - Flag definition
 * @returns Formatted flag line
 */
function formatFlag(name: string, def: FlagDefinition): string {
  const parts: string[] = []

  // Flag name with alias
  const flagName = def.alias ? `--${name}, -${def.alias}` : `--${name}`
  parts.push(flagName.padEnd(20))

  // Type indicator
  const typeIndicator = getTypeIndicator(def)
  if (typeIndicator) {
    parts.push(typeIndicator)
  }

  // Description
  parts.push(def.description)

  // Default value
  if (def.default !== undefined) {
    parts.push(`(default: ${JSON.stringify(def.default)})`)
  }

  // Required indicator
  if (def.isRequired) {
    parts.push('[required]')
  }

  // Choices
  if (def.choices && def.choices.length > 0) {
    parts.push(`[choices: ${def.choices.join(', ')}]`)
  }

  return parts.join(' ')
}

/**
 * Get type indicator for flag definition.
 *
 * @param def - Flag definition
 * @returns Type indicator string or undefined
 */
function getTypeIndicator(def: FlagDefinition): string | undefined {
  switch (def.type) {
    case 'string':
      return '<string>'
    case 'number':
      return '<number>'
    case 'array':
      return '<value...>'
    case 'boolean':
      // Boolean flags don't need type indicator
      return undefined
    default:
      return undefined
  }
}

/**
 * Generate help text listing all available commands.
 *
 * @param registry - Command registry instance
 * @returns Formatted help text for all commands
 */
export function generateGlobalHelp(registry: CommandRegistry): string {
  const lines: string[] = []

  lines.push('Socket CLI - Security analysis for npm packages')
  lines.push('')
  lines.push('Usage:')
  lines.push('  socket <command> [options]')
  lines.push('')

  // Group commands by parent
  const topLevelCommands = registry.list(undefined)
  const visibleTopLevel = topLevelCommands.filter(
    (cmd: CommandDefinition) => !cmd.hidden && !cmd.parent,
  )

  if (visibleTopLevel.length > 0) {
    lines.push('Commands:')
    for (const cmd of visibleTopLevel) {
      const cmdLine = `  ${cmd.name.padEnd(20)} ${cmd.description}`
      lines.push(cmdLine)

      // Show subcommands
      const subcommands = registry.list(cmd.name)
      for (const sub of subcommands) {
        if (!sub.hidden) {
          const subLine = `    ${sub.name.padEnd(18)} ${sub.description}`
          lines.push(subLine)
        }
      }
    }
    lines.push('')
  }

  lines.push('Run "socket <command> --help" for more information on a command.')
  lines.push('')

  return lines.join('\n')
}

/**
 * Check if help was requested for a command.
 *
 * @param args - Command-line arguments
 * @returns True if help flag is present
 */
export function isHelpRequested(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h')
}
