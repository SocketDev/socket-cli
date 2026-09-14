import { isFlagName } from './flag-name.mts'

import type { FlagInitial } from './flag-name.mts'

export type CliCommandName = `${FlagInitial | Uppercase<FlagInitial>}${string}`

export function isCliCommandName(value: string): value is CliCommandName {
  return isFlagName(value)
}
