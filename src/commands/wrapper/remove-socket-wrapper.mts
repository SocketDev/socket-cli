import fs from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'

export function removeSocketWrapper(file: string): void {
  return fs.readFile(file, 'utf8', function (err, data) {
    if (err) {
      logger.fail('There was an error removing the alias:')
      logger.error(err)
      return
    }
    const linesWithoutSocketAlias = data
      .split('\n')
      .filter(
        l => l !== 'alias npm="socket npm"' && l !== 'alias npx="socket npx"',
      )

    const updatedFileContent = linesWithoutSocketAlias.join('\n')

    fs.writeFile(file, updatedFileContent, function (err) {
      if (err) {
        logger.error(err)
        return
      }
      logger.success(`The alias was removed from ${file}. Running 'npm install' will now run the standard npm command in new terminals going forward.`)
      logger.log('')
      logger.info(`Note: We cannot deactivate the alias from current terminal sessions. You have to restart existing terminal sessions to finalize this step.`)
    })
  })
}
