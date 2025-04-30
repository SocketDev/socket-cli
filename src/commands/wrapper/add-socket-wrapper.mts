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
      // TODO: pretty sure you need to source the file or restart
      //       any terminal session before changes are reflected.
      logger.log(
        `
The alias was added to ${file}. Running 'npm install' will now be wrapped in Socket's "safe npm" 🎉
If you want to disable it at any time, run \`socket wrapper --disable\`
      `.trim()
      )
    }
  )
}
