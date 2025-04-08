import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from './fail-msg-with-badge'

export function handleBadInput(
  ...checks: Array<{
    fail: string
    message: string
    pass: string
    test: boolean
    nook?: boolean | undefined
  }>
) {
  if (checks.every(d => d.test)) {
    return false
  }

  const msg = [
    failMsgWithBadge(
      'Input error',
      'Please review the input requirements and try again'
    ),
    ''
  ]
  for (const d of checks) {
    // If nook, then ignore when test is ok
    if (d.nook && d.test) {
      continue
    }
    const lines = d.message.split('\n')

    // If the message has newlines then format the first line with the input
    // expectation and teh rest indented below it
    msg.push(
      `  - ${lines[0]} (${d.test ? colors.green(d.pass) : colors.red(d.fail)})`
    )
    if (lines.length > 1) {
      msg.push(...lines.slice(1).map(str => `    ${str}`))
    }
    msg.push('')
  }

  logger.fail(msg.join('\n'))

  // Use exit status of 2 to indicate incorrect usage, generally invalid
  // options or missing arguments.
  // https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
  process.exitCode = 2

  return true
}
