/**
 * @file Core types for Socket CLI command registry system. Defines command
 *   definitions, flags, validation, middleware, and execution context
 *   interfaces.
 */

import type { CResult } from '../../types.mts'
import type { SpinnerInstance } from '@socketsecurity/lib-stable/spinner/types'

/**
 * Flag type definitions for command arguments.
 */
export type FlagType = 'string' | 'boolean' | 'number' | 'array'

/**
 * Definition for a single command flag/option.
 */
export interface FlagDefinition {
  type: FlagType
  description: string
  alias?: string | undefined
  default?: unknown | undefined
  isRequired?: boolean | undefined
  choices?: readonly string[] | undefined
}

/**
 * Parsed flag values from command invocation.
 */
export type FlagValues = Record<string, unknown>

/**
 * Validation result for command input.
 */
export interface ValidationResult {
  ok: boolean
  errors?: string[] | undefined
}

/**
 * Context provided to command handlers during execution.
 */
export interface CommandContext {
  command: CommandDefinition
  flags: FlagValues
  args: string[]
  spinner?: SpinnerInstance | undefined
  outputKind?: string | undefined
}

/**
 * Middleware function signature for command processing.
 */
export type MiddlewareFn = (
  context: CommandContext,
  next: () => Promise<void>,
) => Promise<void>

/**
 * Hook function signature for before/after command execution.
 */
export type HookFn = (context: CommandContext) => Promise<void>

/**
 * Complete command definition.
 */
export interface CommandDefinition {
  /**
   * Command name (e.g., 'scan', 'repository:create')
   */
  name: string

  /**
   * Human-readable description.
   */
  description: string

  /**
   * Parent command for subcommands (e.g., 'repository' for 'repository:create')
   */
  parent?: string | undefined

  /**
   * Command aliases.
   */
  aliases?: string[] | undefined

  /**
   * Hide from help output.
   */
  hidden?: boolean | undefined

  /**
   * Flag definitions.
   */
  flags?: Record<string, FlagDefinition> | undefined

  /**
   * Main command handler.
   */
  handler: (context: CommandContext) => Promise<CResult<unknown>>

  /**
   * Pre-execution hook.
   */
  before?: HookFn | undefined

  /**
   * Post-execution hook.
   */
  after?: HookFn | undefined

  /**
   * Custom validation logic.
   */
  validate?:
    | ((flags: FlagValues) => ValidationResult | Promise<ValidationResult>)
    | undefined

  /**
   * Examples for help text.
   */
  examples?: string[] | undefined
}

/**
 * Plugin interface for extending registry.
 */
export interface CommandPlugin {
  name: string
  install: (registry: CommandRegistry) => void | Promise<void>
}

/**
 * Command registry interface.
 */
export interface CommandRegistry {
  register(command: CommandDefinition): void
  execute(commandName: string, args: string[]): Promise<CResult<unknown>>
  get(commandName: string): CommandDefinition | undefined
  list(parent?: string): CommandDefinition[]
  has(commandName: string): boolean
  use(middleware: MiddlewareFn | CommandPlugin): void
}
