import { createRequire } from 'node:module'
import path from 'node:path'

import constants from '../constants.mts'

const require = createRequire(import.meta.url)

let _requirements:
  | Readonly<typeof import('../../requirements.json')>
  | undefined

export function getRequirements() {
  if (_requirements === undefined) {
    _requirements = /*@__PURE__*/ require(
      path.join(constants.rootPath, 'requirements.json'),
    )
  }
  return _requirements!
}

/**
 * Convert command path to requirements key.
 */
export function getRequirementsKey(cmdPath: string): string {
  const colonIndex = cmdPath.lastIndexOf(':')
  return colonIndex === -1 ? cmdPath : cmdPath.slice(colonIndex + 1)
}
