import {
  BUN,
  NPM,
  PNPM,
  VLT,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/lib-stable/constants/agents'

export const AGENTS = [BUN, NPM, PNPM, YARN_BERRY, YARN_CLASSIC, VLT] as const

export type Agent = (typeof AGENTS)[number]
