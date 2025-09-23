import { handleWhoami } from './handle-whoami.mts'

export const CMD_NAME = 'whoami'

const description = 'Check Socket CLI authentication status'

const hidden = false

export const cmdWhoami = {
  description,
  hidden,
  run: handleWhoami,
}
