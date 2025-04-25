import { logger } from '@socketsecurity/registry/lib/logger'

import {
  getConfigValue,
  isReadOnlyConfig,
  sensitiveConfigKeys,
  supportedConfigKeys
} from '../../utils/config'

import type { OutputKind } from '../../types'

export async function outputConfigList({
  full,
  outputKind
}: {
  full: boolean
  outputKind: OutputKind
}) {
  const readOnly = isReadOnlyConfig()
  if (outputKind === 'json') {
    const obj: Record<string, unknown> = {}
    for (const key of supportedConfigKeys.keys()) {
      let value = getConfigValue(key)
      if (!full && sensitiveConfigKeys.has(key)) {
        value = '********'
      }
      if (full || value !== undefined) {
        obj[key as any] = value ?? '<none>'
      }
    }
    logger.log(
      JSON.stringify(
        {
          success: true,
          full,
          config: obj,
          readOnly
        },
        null,
        2
      )
    )
  } else {
    const maxWidth = Array.from(supportedConfigKeys.keys()).reduce(
      (a, b) => Math.max(a, b.length),
      0
    )

    logger.log('# Local CLI Config')
    logger.log('')
    logger.log(`This is the local CLI config (full=${!!full}):`)
    logger.log('')
    for (const key of supportedConfigKeys.keys()) {
      let value = getConfigValue(key)
      if (!full && sensitiveConfigKeys.has(key)) {
        value = '********'
      }
      if (full || value !== undefined) {
        logger.log(
          `- ${key}:${' '.repeat(Math.max(0, maxWidth - key.length + 3))} ${Array.isArray(value) ? value.join(', ') || '<none>' : (value ?? '<none>')}`
        )
      }
    }
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily\n      overridden from an env var or command flag.'
      )
    }
  }
}
