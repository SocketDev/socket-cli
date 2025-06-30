import { readFileSync, writeFileSync } from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'

export function removeSocketWrapper(filepath: string): void {
  let content: string | undefined
  try {
    content = readFileSync(filepath, 'utf8')
  } catch (e) {
    logger.fail(`There was an error removing the alias${e ? ':' : '.'}`)
    if (e) {
      logger.error(e)
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
      logger.error(e)
    }
    return
  }

  logger.success(
    `The alias was removed from ${filepath}. Running 'npm install' will now run the standard npm command in new terminals going forward.`,
  )
  logger.log('')
  logger.info(
    `Note: We cannot deactivate the alias from current terminal sessions. You have to restart existing terminal sessions to finalize this step.`,
  )
}
