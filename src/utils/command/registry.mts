/** @fileoverview Command registry system for Socket CLI. Provides declarative command definitions, middleware, and plugin support. */

export { defineCommand } from './registry-define.mjs'
export { registry, CommandRegistry } from './registry-core.mjs'
export {
  generateCommandHelp,
  generateGlobalHelp,
  isHelpRequested,
} from './registry-help.mjs'

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
} from './registry-types.mjs'
