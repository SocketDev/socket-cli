import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from './fail-msg-with-badge.mts'
import { serializeResultJson } from './serialize-result-json.mts'

import type { OutputKind } from '../types.mts'

export function checkCommandInput(
  outputKind: OutputKind,
  ...checks: Array<{
    fail: string
    message: string
    pass: string
    test: boolean
    nook?: boolean | undefined
  }>
): boolean {
  if (checks.every(d => d.test)) {
    return true
  }

  const msg = ['Please review the input requirements and try again', '']
  for (const d of checks) {
    // If nook, then ignore when test is ok
    if (d.nook && d.test) {
      continue
    }
    const lines = d.message.split('\n')
    const { length: lineCount } = lines
    if (!lineCount) {
      continue
    }
    // If the message has newlines then format the first line with the input
    // expectation and the rest indented below it.
    msg.push(
      `  - ${lines[0]} (${d.test ? colors.green(d.pass) : colors.red(d.fail)})`
    )
    if (lineCount > 1) {
      msg.push(...lines.slice(1).map(str => `    ${str}`))
    }
    msg.push('')
  }

  // Use exit status of 2 to indicate incorrect usage, generally invalid
  // options or missing arguments.
  // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
  process.exitCode = 2

  if (outputKind === 'json') {
    logger.log(
      serializeResultJson({
        ok: false,
        message: 'Input error',
        data: msg.join('\n')
      })
    )
  } else {
    logger.fail(failMsgWithBadge('Input error', msg.join('\n')))
  }

  return false
}
