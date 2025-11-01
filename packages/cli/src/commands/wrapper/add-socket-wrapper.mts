import fs from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

export function addSocketWrapper(file: string): void {
  fs.appendFile(
    file,
    'alias npm="socket npm"\nalias npx="socket npx"\n',
    err => {
      if (err) {
        return new Error(`There was an error setting up the alias: ${err}`)
      }
      getDefaultLogger().success(
        `The alias was added to ${file}. Running 'npm install' will now be wrapped in Socket's "safe npm" 🎉`,
      )
      getDefaultLogger().log(
        '  If you want to disable it at any time, run `socket wrapper --disable`',
      )
      getDefaultLogger().log('')
      getDefaultLogger().info(
        'This will only be active in new terminal sessions going forward.',
      )
      getDefaultLogger().log(
        '  You will need to restart your terminal or run this command to activate the alias in the current session:',
      )
      getDefaultLogger().log('')
      getDefaultLogger().log(`    source ${file}`)
      getDefaultLogger().log('')
      getDefaultLogger().log('(You only need to do this once)')
    },
  )
}
