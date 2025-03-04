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
        l => l !== 'alias npm="socket npm"' && l !== 'alias npx="socket npx"'
      )

    const updatedFileContent = linesWithoutSocketAlias.join('\n')

    fs.writeFile(file, updatedFileContent, function (err) {
      if (err) {
        logger.error(err)
        return
      }
      // TODO: pretty sure you need to source the file or restart
      //       any terminal session before changes are reflected.
      logger.log(
        `The alias was removed from ${file}. Running 'npm install' will now run the standard npm command.`
      )
    })
  })
}
