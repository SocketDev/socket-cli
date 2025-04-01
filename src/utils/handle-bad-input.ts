import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { failMsgWithBadge } from './fail-msg-with-badge'

export function handleBadInput(
  ...arr: Array<{
    message: string
    nook?: unknown // Only display error when test is not OK
    test: unknown // Truthy checked through !!
    pass: string
    fail: string
  }>
) {
  if (arr.every(data => !!data.test)) {
    return false
  }

  const msg = [
    failMsgWithBadge(
      'Input error',
      'Please review the input requirements and try again'
    ),
    ''
  ]
  for (const data of arr) {
    // If nook, then ignore when test is ok
    if (data.nook && data.test) {
      continue
    }
    const lines = data.message.split('\n')

    // If the message has newlines then format the first line with the input
    // expectation and teh rest indented below it
    msg.push(
      `  - ${lines[0]} (${data.test ? colors.green(data.pass) : colors.red(data.fail)})`
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
