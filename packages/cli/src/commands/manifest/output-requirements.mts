import fs from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { REQUIREMENTS_TXT } from '../../constants/paths.mjs'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

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
      getDefaultLogger().log(serializeResultJson(result))
      return
    }
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  if (outputKind === 'json') {
    const json = serializeResultJson(result)

    if (out === '-') {
      getDefaultLogger().log(json)
    } else {
      fs.writeFileSync(out, json, 'utf8')
    }

    return
  }

  if (outputKind === 'markdown') {
    const arr = []
    arr.push(mdHeader('Converted Conda file'))
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
      getDefaultLogger().log(md)
    } else {
      fs.writeFileSync(out, md, 'utf8')
    }
    return
  }

  if (out === '-') {
    getDefaultLogger().log(result.data.pip)
    getDefaultLogger().log('')
  } else {
    fs.writeFileSync(out, result.data.pip, 'utf8')
  }
}
