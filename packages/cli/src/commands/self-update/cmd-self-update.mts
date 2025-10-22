/**
 * Self-update command for SEA binaries.
 *
 * This command is hidden when not running as a SEA binary and provides
 * automatic update functionality for self-contained executables.
 */

import { handleSelfUpdate } from './handle-self-update.mts'

export const CMD_NAME = 'self-update'

const description = 'Update Socket CLI to the latest version'
const hidden = true

export const cmdSelfUpdate = {
  description,
  hidden,
  run: handleSelfUpdate,
}
