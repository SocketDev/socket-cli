/**
 * Requirements configuration utilities for Socket CLI.
 * Manages API permissions and quota requirements for commands.
 *
 * Key Functions:
 * - getRequirements: Load requirements configuration
 * - getRequirementsKey: Convert command path to requirements key
 *
 * Configuration:
 * - Loads from data/command-api-requirements.json
 * - Maps command paths to permission requirements
 * - Used for permission validation and help text
 */

import requirements from '../../../data/command-api-requirements.json' with { type: 'json' }

export function getRequirements() {
  return requirements
}

/**
 * Convert command path to requirements key.
 */
export function getRequirementsKey(cmdPath: string): string {
  return cmdPath.replace(/^socket[: ]/, '').replace(/ +/g, ':')
}
