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
  await meowWithSubcommands(
    cliCommands,
    {
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
