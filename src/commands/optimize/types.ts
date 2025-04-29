import type { StringKeyValueObject } from '../../types'

export type NpmOverrides = { [key: string]: string | StringKeyValueObject }

export type PnpmOrYarnOverrides = { [key: string]: string }

export type Overrides = NpmOverrides | PnpmOrYarnOverrides
