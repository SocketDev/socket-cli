import { readFileSync, writeFileSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

export function removeSocketWrapper(filepath: string): void {
  let content: string | undefined
  try {
    content = readFileSync(filepath, 'utf8')
  } catch (e) {
    getDefaultLogger().fail(
      `There was an error removing the alias${e ? ':' : '.'}`,
    )
    if (e) {
      getDefaultLogger().error(e)
    }
    return
  }

  const linesWithoutSocketAlias = content
    .split('\n')
    .filter(
      l => l !== 'alias npm="socket npm"' && l !== 'alias npx="socket npx"',
    )
  const updatedContent = linesWithoutSocketAlias.join('\n')
  try {
    writeFileSync(filepath, updatedContent, 'utf8')
  } catch (e) {
    if (e) {
      getDefaultLogger().error(e)
    }
    return
  }

  getDefaultLogger().success(
    `The alias was removed from ${filepath}. Running 'npm install' will now run the standard npm command in new terminals going forward.`,
  )
  getDefaultLogger().log('')
  getDefaultLogger().info(
    'Note: We cannot deactivate the alias from current terminal sessions. You have to restart existing terminal sessions to finalize this step.',
  )
}
