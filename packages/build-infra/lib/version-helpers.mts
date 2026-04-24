/**
 * Version helpers used by the build-pipeline orchestrator.
 *
 * The socket-btm version of this file also fetches Node.js release
 * checksums and extracts submodule SHAs for its native-binary builders;
 * ultrathink's lang wasm pipelines don't need any of that. Keep only
 * getNodeVersion and getToolVersion (the two the orchestrator imports).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors'

/**
 * The Node.js version running this process, without the leading "v".
 */
export function getNodeVersion(): string {
  return process.version.replace(/^v/, '')
}

/**
 * Read a pinned tool version from the package's external-tools.json.
 *
 * @throws when the file is missing or the tool has no version recorded.
 */
export async function getToolVersion(
  packageRoot: string,
  toolName: string,
): Promise<string> {
  const filePath = path.join(packageRoot, 'external-tools.json')
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (e) {
    throw new Error(`Failed to read ${filePath}: ${errorMessage(e)}`, {
      cause: e,
    })
  }
  let data: any
  try {
    data = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Failed to parse ${filePath}: ${errorMessage(e)}`, {
      cause: e,
    })
  }
  const version = data?.tools?.[toolName]?.version
  if (!version) {
    throw new Error(
      `external-tools.json in ${packageRoot} has no version pinned for "${toolName}".`,
    )
  }
  return version
}
