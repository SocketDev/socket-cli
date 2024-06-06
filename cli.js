#!/usr/bin/env node
/* eslint-disable no-console */

import chalk from 'chalk'
import { messageWithCauses, stackWithCauses } from 'pony-cause'

import * as cliCommands from './lib/commands/index.js'
import { logSymbols } from './lib/utils/chalk-markdown.js'
import { AuthError, InputError } from './lib/utils/errors.js'
import { meowWithSubcommands } from './lib/utils/meow-with-subcommands.js'
import { initUpdateNotifier } from './lib/utils/update-notifier.js'

// TODO: Add autocompletion using https://www.npmjs.com/package/omelette

initUpdateNotifier()

try {
  const formattedCliCommands = Object.fromEntries(Object.entries(cliCommands).map((entry) => {
    if (entry[0] === 'rawNpm') {
      entry[0] = 'raw-npm'
    } else if (entry[0] === 'rawNpx') {
      entry[0] = 'raw-npx'
    } else if (entry[0] === 'fullscans') {
      entry[0] = 'full-scans'
    }
    return entry
  }))

  await meowWithSubcommands(
    formattedCliCommands,
    {
      aliases: {
        ci: {
          description: 'Alias for "report create --view --strict"',
          argv: ['report', 'create', '--view', '--strict']
        },
      },
      argv: process.argv.slice(2),
      name: 'socket',
      importMeta: import.meta
    }
  )
} catch (err) {
  /** @type {string} */
  let errorTitle
  /** @type {string} */
  let errorMessage = ''
  /** @type {string|undefined} */
  let errorBody

  if (err instanceof AuthError) {
    errorTitle = 'Authentication error'
    errorMessage = err.message
  } else if (err instanceof InputError) {
    errorTitle = 'Invalid input'
    errorMessage = err.message
    errorBody = err.body
  } else if (err instanceof Error) {
    errorTitle = 'Unexpected error'
    errorMessage = messageWithCauses(err)
    errorBody = stackWithCauses(err)
  } else {
    errorTitle = 'Unexpected error with no details'
  }

  console.error(`${logSymbols.error} ${chalk.white.bgRed(errorTitle + ':')} ${errorMessage}`)
  if (errorBody) {
    console.error('\n' + errorBody)
  }

  process.exit(1)
}
