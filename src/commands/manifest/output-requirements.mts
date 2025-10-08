/** @fileoverview Requirements.txt output formatter for Socket CLI. Displays converted Conda pip dependencies in JSON, markdown, or plain text formats. Supports stdout and file output. */

import fs from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'

import { REQUIREMENTS_TXT } from '../../constants.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputRequirements(
  result: CResult<{ content: string; pip: string }>,
  outputKind: OutputKind,
  out: string,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (!result.ok) {
    if (outputKind === 'json') {
      logger.log(serializeResultJson(result))
      return
    }
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (outputKind === 'json') {
    const json = serializeResultJson(result)

    if (out === '-') {
      // Use console.log directly for JSON output to ensure it's not silenced
      console.log(json)
    } else {
      fs.writeFileSync(out, json, 'utf8')
    }

    return
  }

  if (outputKind === 'markdown') {
    const arr = []
    arr.push('# Converted Conda file')
    arr.push('')
    arr.push(
      `This is the Conda \`environment.yml\` file converted to python \`${REQUIREMENTS_TXT}\`:`,
    )
    arr.push('')
    arr.push(`\`\`\`file=${REQUIREMENTS_TXT}`)
    arr.push(result.data.pip)
    arr.push('```')
    arr.push('')
    const md = arr.join('\n')

    if (out === '-') {
      logger.log(md)
    } else {
      fs.writeFileSync(out, md, 'utf8')
    }
    return
  }

  if (out === '-') {
    logger.log(result.data.pip)
    logger.log('')
  } else {
    fs.writeFileSync(out, result.data.pip, 'utf8')
  }
}
