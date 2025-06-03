import fs from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'

export function addSocketWrapper(file: string): void {
  return fs.appendFile(
    file,
    'alias npm="socket npm"\nalias npx="socket npx"\n',
    err => {
      if (err) {
        return new Error(`There was an error setting up the alias: ${err}`)
      }
      logger.success(
        `The alias was added to ${file}. Running 'npm install' will now be wrapped in Socket's "safe npm" 🎉`,
      )
      logger.log(
        `  If you want to disable it at any time, run \`socket wrapper --disable\``,
      )
      logger.log('')
      logger.info(
        `This will only be active in new terminal sessions going forward.`,
      )
      logger.log(
        `  You will need to restart your terminal or run this command to activate the alias in the current session:`,
      )
      logger.log('')
      logger.log(`    source ${file}`)
      logger.log('')
      logger.log(`(You only need to do this once)`)
    },
  )
}
