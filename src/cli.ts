#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import chalk from 'chalk'
import { messageWithCauses, stackWithCauses } from 'pony-cause'
import updateNotifier from 'update-notifier'

import * as cliCommands from './commands'
import { logSymbols } from './utils/chalk-markdown'
import { AuthError, InputError } from './utils/errors'
import { meowWithSubcommands } from './utils/meow-with-subcommands'

const distPath = __dirname
const rootPath = path.resolve(distPath, '..')

const formattedCliCommands = Object.fromEntries(
  Object.entries(cliCommands).map(entry => {
    entry[0] = camelToHyphen(entry[0])
    return entry
  })
)

function camelToHyphen(str: string): string {
  return str.replace(/[A-Z]+/g, '-$&').toLowerCase()
}

// TODO: Add autocompletion using https://www.npmjs.com/package/omelette
;(async () => {
  try {
    updateNotifier({
      pkg: JSON.parse(readFileSync(path.join(rootPath, 'package.json'), 'utf8'))
    }).notify()
  } catch {}

  try {
    await meowWithSubcommands(formattedCliCommands, {
      aliases: {
        ci: {
          description: 'Alias for "report create --view --strict"',
          argv: ['report', 'create', '--view', '--strict']
        }
      },
      argv: process.argv.slice(2),
      name: 'socket',
      importMeta: { url: `${pathToFileURL(__filename)}` } as ImportMeta
    })
  } catch (err) {
    let errorTitle: string
    let errorMessage = ''
    let errorBody: string | undefined

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

    console.error(
      `${logSymbols.error} ${chalk.white.bgRed(errorTitle + ':')} ${errorMessage}`
    )
    if (errorBody) {
      console.error(`\n${errorBody}`)
    }

    process.exit(1)
  }
})()
