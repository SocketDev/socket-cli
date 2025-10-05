/** @fileoverview Command registry system for Socket CLI. Provides declarative command definitions, middleware, and plugin support. */

export { defineCommand } from './define-command.mts'
export { registry, CommandRegistry } from './registry.mts'
export {
  generateCommandHelp,
  generateGlobalHelp,
  isHelpRequested,
} from './help.mts'

export type {
  CommandContext,
  CommandDefinition,
  CommandPlugin,
  CommandRegistry as ICommandRegistry,
  FlagDefinition,
  FlagType,
  FlagValues,
  HookFn,
  MiddlewareFn,
  ValidationResult,
} from './types.mts'
