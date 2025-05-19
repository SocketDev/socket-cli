import { logger } from '@socketsecurity/registry/lib/logger'

import {
  getConfigValue,
  isReadOnlyConfig,
  sensitiveConfigKeys,
  supportedConfigKeys,
} from '../../utils/config.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { OutputKind } from '../../types.mts'

export async function outputConfigList({
  full,
  outputKind,
}: {
  full: boolean
  outputKind: OutputKind
}) {
  const readOnly = isReadOnlyConfig()
  if (outputKind === 'json') {
    let failed = false
    const obj: Record<string, unknown> = {}
    for (const key of supportedConfigKeys.keys()) {
      const result = getConfigValue(key)
      let value = result.data
      if (!result.ok) {
        value = `Failed to retrieve: ${result.message}`
        failed = true
      } else if (!full && sensitiveConfigKeys.has(key)) {
        value = '********'
      }
      if (full || value !== undefined) {
        obj[key as any] = value ?? '<none>'
      }
    }
    if (failed) {
      process.exitCode = 1
    }
    logger.log(
      serializeResultJson(
        failed
          ? {
              ok: false,
              message: 'At least one config key failed to be fetched...',
              data: JSON.stringify({
                full,
                config: obj,
                readOnly,
              }),
            }
          : {
              ok: true,
              data: {
                full,
                config: obj,
                readOnly,
              },
            },
      ),
    )
  } else {
    const maxWidth = Array.from(supportedConfigKeys.keys()).reduce(
      (a, b) => Math.max(a, b.length),
      0,
    )

    logger.log('# Local CLI Config')
    logger.log('')
    logger.log(`This is the local CLI config (full=${!!full}):`)
    logger.log('')
    for (const key of supportedConfigKeys.keys()) {
      const result = getConfigValue(key)
      if (!result.ok) {
        logger.log(`- ${key}: failed to read: ${result.message}`)
      } else {
        let value = result.data
        if (!full && sensitiveConfigKeys.has(key)) {
          value = '********'
        }
        if (full || value !== undefined) {
          logger.log(
            `- ${key}:${' '.repeat(Math.max(0, maxWidth - key.length + 3))} ${Array.isArray(value) ? value.join(', ') || '<none>' : (value ?? '<none>')}`,
          )
        }
      }
    }
    if (readOnly) {
      logger.log('')
      logger.log(
        'Note: the config is in read-only mode, meaning at least one key was temporarily\n      overridden from an env var or command flag.',
      )
    }
  }
}
