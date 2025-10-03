/** @fileoverview Type definitions for Socket CLI optimize command. Defines override types for npm (nested), pnpm, and yarn (flat) package manager override formats. */

import type { StringKeyValueObject } from '../../types.mts'

export type NpmOverrides = { [key: string]: string | StringKeyValueObject }

export type PnpmOrYarnOverrides = { [key: string]: string }

export type Overrides = NpmOverrides | PnpmOrYarnOverrides
