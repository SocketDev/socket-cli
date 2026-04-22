import { promises as fs } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { InputError } from '../../utils/error/errors.mts'

const logger = getDefaultLogger()

export async function addSocketWrapper(file: string): Promise<void> {
  try {
    await fs.appendFile(
      file,
      'alias npm="socket npm"\nalias npx="socket npx"\n',
    )
  } catch (e) {
    throw new InputError(
      `failed to append socket aliases to ${file} (${e instanceof Error ? e.message : String(e)}); check that the file exists and is writable`,
    )
  }
  logger.success(
    `The alias was added to ${file}. Running 'npm install' will now be wrapped in Socket's "safe npm" 🎉`,
  )
  logger.log(
    '  If you want to disable it at any time, run `socket wrapper --disable`',
  )
  logger.log('')
  logger.info(
    'This will only be active in new terminal sessions going forward.',
  )
  logger.log(
    '  You will need to restart your terminal or run this command to activate the alias in the current session:',
  )
  logger.log('')
  logger.log(`    source ${file}`)
  logger.log('')
  logger.log('(You only need to do this once)')
}
