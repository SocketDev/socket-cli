/** @fileoverview Command registry implementation for Socket CLI. Manages command registration, execution, middleware, and plugin support. */

import type {
  CommandContext,
  CommandDefinition,
  CommandPlugin,
  FlagValues,
  CommandRegistry as ICommandRegistry,
  MiddlewareFn,
} from './registry-types.mjs'
import type { CResult } from '../../types.mts'

/**
 * Central registry for CLI commands.
 * Handles registration, discovery, execution, and middleware.
 */
export class CommandRegistry implements ICommandRegistry {
  private commands = new Map<string, CommandDefinition>()
  private middleware: MiddlewareFn[] = []
  private plugins: CommandPlugin[] = []

  /**
   * Register a command definition.
   */
  register(command: CommandDefinition): void {
    if (this.commands.has(command.name)) {
      throw new Error(
        `Command "${command.name}" is already registered. Use a unique name or unregister first.`,
      )
    }

    this.commands.set(command.name, command)

    // Register aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        if (this.commands.has(alias)) {
          throw new Error(
            `Alias "${alias}" conflicts with existing command "${this.commands.get(alias)?.name}"`,
          )
        }
        // Store alias pointing to main command
        this.commands.set(alias, command)
      }
    }
  }

  /**
   * Get a registered command by name.
   */
  get(commandName: string): CommandDefinition | undefined {
    return this.commands.get(commandName)
  }

  /**
   * Check if a command is registered.
   */
  has(commandName: string): boolean {
    return this.commands.has(commandName)
  }

  /**
   * List all registered commands, optionally filtered by parent.
   */
  list(parent?: string): CommandDefinition[] {
    const commands = Array.from(this.commands.values())

    // Remove duplicates (aliases point to same command)
    const unique = Array.from(
      new Map(commands.map(cmd => [cmd.name, cmd])).values(),
    )

    if (parent !== undefined) {
      return unique.filter(cmd => cmd.parent === parent)
    }

    return unique
  }

  /**
   * Install middleware or plugin.
   */
  use(middlewareOrPlugin: MiddlewareFn | CommandPlugin): void {
    if (typeof middlewareOrPlugin === 'function') {
      this.middleware.push(middlewareOrPlugin)
    } else {
      // Plugin
      this.plugins.push(middlewareOrPlugin)
      middlewareOrPlugin.install(this)
    }
  }

  /**
   * Execute a command by name with given arguments.
   */
  async execute(
    commandName: string,
    args: string[],
  ): Promise<CResult<unknown>> {
    const command = this.commands.get(commandName)

    if (!command) {
      return {
        ok: false,
        message: `Unknown command: ${commandName}`,
        cause: `Command "${commandName}" is not registered. Run "socket --help" to see available commands.`,
      }
    }

    // Parse flags from args (wrap in try/catch for validation errors)
    let flags: FlagValues
    try {
      flags = await this.parseFlags(command, args)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error ? error.stack : undefined,
      }
    }

    // Build context
    const context: CommandContext = {
      command,
      flags,
      args,
    }

    // Validate
    if (command.validate) {
      const validation = await command.validate(flags)
      if (!validation.ok) {
        return {
          ok: false,
          message: 'Validation failed',
          cause: validation.errors?.join('\n'),
        }
      }
    }

    // Execute with middleware chain
    try {
      await this.executeWithMiddleware(context)

      // If handler returned a result, we'd have it in context
      // For now, return success
      return { ok: true, data: undefined }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error ? error.stack : undefined,
      }
    }
  }

  /**
   * Execute command handler through middleware chain.
   */
  private async executeWithMiddleware(context: CommandContext): Promise<void> {
    const { command } = context

    // Build middleware chain including hooks
    const chain: MiddlewareFn[] = []

    // Add registered global middleware
    chain.push(...this.middleware)

    // Add before hook as middleware
    if (command.before) {
      chain.push(async (ctx, next) => {
        await command.before!(ctx)
        await next()
      })
    }

    // Add main handler with after hook wrapper
    chain.push(async ctx => {
      await ctx.command.handler(ctx)
      // Execute after hook immediately after handler
      if (command.after) {
        await command.after(ctx)
      }
    })

    // Execute chain
    await this.composeMiddleware(chain, context)
  }

  /**
   * Compose middleware into execution chain.
   */
  private async composeMiddleware(
    middleware: MiddlewareFn[],
    context: CommandContext,
  ): Promise<void> {
    let index = -1

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error('next() called multiple times')
      }

      index = i

      const fn = middleware[i]

      if (!fn) {
        return
      }

      await fn(context, () => dispatch(i + 1))
    }

    await dispatch(0)
  }

  /**
   * Parse command-line arguments into flag values.
   * Basic implementation - can be enhanced with a proper parser.
   */
  private async parseFlags(
    command: CommandDefinition,
    args: string[],
  ): Promise<FlagValues> {
    const flags: FlagValues = {}

    if (!command.flags) {
      return flags
    }

    // Initialize with defaults
    for (const [name, def] of Object.entries(command.flags)) {
      if (def.default !== undefined) {
        flags[name] = def.default
      }
    }

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]

      if (!arg?.startsWith('--')) {
        continue
      }

      // Handle --flag=value
      const [flagName, ...valueParts] = arg.slice(2).split('=')
      const flagDef = command.flags[flagName!]

      if (!flagDef) {
        // Unknown flag - skip for now (could warn)
        continue
      }

      let value: unknown

      if (valueParts.length > 0) {
        // --flag=value format
        value = valueParts.join('=')
      } else if (flagDef.type === 'boolean') {
        // --flag format for boolean
        value = true
      } else {
        // --flag value format
        value = args[++i]
      }

      // Type conversion
      switch (flagDef.type) {
        case 'number': {
          value = Number(value)
          break
        }
        case 'boolean': {
          value = value === 'true' || value === true
          break
        }
        case 'array': {
          if (!Array.isArray(flags[flagName!])) {
            flags[flagName!] = []
          }
          ;(flags[flagName!] as unknown[]).push(value)
          continue
        }
        // string: no conversion needed
      }

      flags[flagName!] = value
    }

    // Validate required flags
    for (const [name, def] of Object.entries(command.flags)) {
      if (def.isRequired && flags[name] === undefined) {
        throw new Error(`Required flag --${name} is missing`)
      }
    }

    return flags
  }
}

/**
 * Global registry instance.
 */
export const registry = new CommandRegistry()
