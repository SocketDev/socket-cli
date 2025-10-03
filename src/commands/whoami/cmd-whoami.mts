/** @fileoverview Whoami command for Socket CLI. Checks and displays Socket CLI authentication status including logged-in user information and API token validity. */

import { handleWhoami } from './handle-whoami.mts'

export const CMD_NAME = 'whoami'

const description = 'Check Socket CLI authentication status'

const hidden = false

export const cmdWhoami = {
  description,
  hidden,
  run: handleWhoami,
}
