import fs from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'

export type ManifestResult = {
  files: string[]
  type: 'gradle' | 'sbt'
  success: boolean
}

export async function outputManifest(
  result: CResult<ManifestResult>,
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
    const { files, type } = result.data
    const typeName = type === 'gradle' ? 'Gradle' : 'SBT'

    arr.push(mdHeader(`${typeName} Manifest Generation`))
    arr.push('')
    arr.push(
      `Successfully generated ${files.length} POM file${files.length === 1 ? '' : 's'} from ${typeName} project:`,
    )
    arr.push('')

    for (const file of files) {
      arr.push(`- \`${file}\``)
    }

    arr.push('')
    arr.push(mdHeader('Next Steps', 2))
    arr.push('')
    arr.push('Generate a security scan by running:')
    arr.push('')
    arr.push('```bash')
    arr.push('socket scan create')
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

  // Text mode output - this is handled by the converter functions themselves.
  // This path shouldn't normally be reached as text mode logs directly.
}
