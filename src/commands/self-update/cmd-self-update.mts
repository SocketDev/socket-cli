/** @fileoverview Self-update command for Socket CLI SEA binaries. Provides automatic update functionality for single-executable applications. Hidden when not running as SEA binary. */

import { handleSelfUpdate } from './handle-self-update.mts'

export const CMD_NAME = 'self-update'

const description = 'Update Socket CLI to the latest version'
const hidden = true

export const cmdSelfUpdate = {
  description,
  hidden,
  run: handleSelfUpdate,
}
