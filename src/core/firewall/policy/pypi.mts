import type { FirewallArtifact } from './types.mts'
import { firewallUrlPath } from './parser-utils.mts'

const pythonVersion =
  '(?:\\d+!)?\\d+(?:\\.\\d+)*(?:(?:a|b|rc)\\d+)?(?:\\.post\\d+)?(?:\\.dev\\d+)?(?:\\+[a-z0-9]+(?:[._-][a-z0-9]+)*)?'
const pythonSource = new RegExp(
  `^(?<name>[a-zA-Z0-9._-]+)-(?<version>${pythonVersion})\\.(?:tar\\.gz|zip)(?:\\.metadata)?$`,
  'i',
)
const pythonWheel = new RegExp(
  `^(?<name>[a-zA-Z0-9._]+)-(?<version>${pythonVersion})(?:-\\d[a-zA-Z0-9_]*)?-[a-zA-Z0-9_.]+-[a-zA-Z0-9_.]+-[a-zA-Z0-9_.]+\\.whl(?:\\.metadata)?$`,
  'i',
)

export function parsePypiUrlPath(
  urlOrPath: string,
): FirewallArtifact | undefined {
  const pathname = firewallUrlPath(urlOrPath)
  const filename = pathname.split('/').pop() ?? ''
  const match = pythonSource.exec(filename) ?? pythonWheel.exec(filename)
  if (!match?.groups) {
    return undefined
  }
  return {
    name: match.groups['name']!,
    type: 'pypi',
    version: match.groups['version'],
  }
}
