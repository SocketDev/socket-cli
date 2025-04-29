import type { RangeStyle } from '../../utils/semver'

type StripUndefined<T> = {
  [K in keyof T]-?: Exclude<T[K], undefined>
}

export type FixOptions = {
  autoMerge?: boolean | undefined
  autopilot?: boolean | undefined
  cwd?: string | undefined
  purls?: string[] | readonly string[] | undefined
  rangeStyle?: RangeStyle | undefined
  test?: boolean | undefined
  testScript?: string | undefined
}

export type NormalizedFixOptions = StripUndefined<Required<FixOptions>>
