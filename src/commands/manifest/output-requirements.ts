import fs from 'node:fs'

import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types'

export async function outputRequirements(
  data: { contents: string; pip: string },
  outputKind: OutputKind,
  out: string
) {
  if (outputKind === 'json') {
    const json = JSON.stringify(
      {
        ok: true,
        data: {
          pip: data.pip
        }
      },
      undefined,
      2
    )

    if (out === '-') {
      logger.log(json)
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
      'This is the Conda `environment.yml` file converted to python `requirements.txt`:'
    )
    arr.push('')
    arr.push('```file=requirements.txt')
    arr.push(data.pip)
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
    logger.log(data.pip)
    logger.log('')
  } else {
    fs.writeFileSync(out, data.pip, 'utf8')
  }
}
