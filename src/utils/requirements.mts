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

import { createRequire } from 'node:module'
import path from 'node:path'

import constants from '../constants.mts'

const require = createRequire(import.meta.url)

let _requirements:
  | Readonly<typeof import('../../data/command-api-requirements.json')>
  | undefined

export function getRequirements() {
  if (_requirements === undefined) {
    _requirements = /*@__PURE__*/ require(
      path.join(constants.rootPath, 'data', 'command-api-requirements.json'),
    )
  }
  return _requirements!
}

/**
 * Convert command path to requirements key.
 */
export function getRequirementsKey(cmdPath: string): string {
  return cmdPath.replace(/^socket[: ]/, '').replace(/ +/g, ':')
}
