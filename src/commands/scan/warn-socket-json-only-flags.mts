import { logger } from '@socketsecurity/registry/lib/logger'

import { camelToKebab } from '../../utils/strings.mts'
import { DSI_SETUP_COMMAND } from '../manifest/scripts/resolution-report-render.mts'

// Build options that `socket manifest <tool>` takes as flags but the scan
// commands read from each build's socket.json, so passing them does nothing.
const SOCKET_JSON_ONLY_FLAGS = [
  'excludeConfigs',
  'ignoreUnresolved',
  'includeConfigs',
  'verbose',
]

export function warnSocketJsonOnlyFlags(
  flags: Record<string, unknown>,
  command: string,
): void {
  const ignored = SOCKET_JSON_ONLY_FLAGS.filter(
    name => flags[name] !== undefined,
  ).map(name => `--${camelToKebab(name)}`)
  if (ignored.length) {
    logger.warn(
      `Ignoring ${ignored.join(', ')}: \`${command}\` reads build options from each build's socket.json. Set them there, for example with \`${DSI_SETUP_COMMAND}\`.`,
    )
  }
}
