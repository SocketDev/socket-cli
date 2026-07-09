/**
 * Cached git executable resolution shared by every git-operations module.
 *
 * Extracted from operations.mts to keep that file under the 1000-line
 * File size hard cap.
 */

import { whichReal } from '@socketsecurity/lib-stable/bin/which'

// Cache git executable path
let gitPath: string | undefined = undefined

export async function getGitPath(): Promise<string> {
  if (!gitPath) {
    const result = await whichReal('git', { nothrow: true })
    if (!result || Array.isArray(result)) {
      throw new Error(
        `git executable not found on PATH (whichReal returned ${Array.isArray(result) ? 'multiple matches' : 'null'}); install git (e.g. \`brew install git\`, \`apt install git\`) and make sure it is reachable on PATH`,
      )
    }
    gitPath = result
  }
  return gitPath
}
