/** @fileoverview Helper for defining CLI commands in a declarative way. Provides defineCommand function that registers commands with the global registry. */

import { registry } from './registry.mts'

import type { CommandDefinition } from './registry-types.mjs'

/**
 * Define and register a command with the global registry.
 * This is the primary API for creating new commands.
 *
 * @example
 * ```typescript
 * export default defineCommand({
 *   name: 'scan',
 *   description: 'Scan a project for security issues',
 *   flags: {
 *     dir: {
 *       type: 'string',
 *       description: 'Directory to scan',
 *       default: '.'
 *     }
 *   },
 *   async handler({ flags }) {
 *     const result = await scanProject(flags.dir)
 *     return { ok: true, data: result }
 *   }
 * })
 * ```
 */
export function defineCommand(
  definition: CommandDefinition,
): CommandDefinition {
  registry.register(definition)
  return definition
}
