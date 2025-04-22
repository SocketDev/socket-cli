import type { RangeStyle } from '../../utils/semver'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

type StripUndefined<T> = {
  [K in keyof T]-?: Exclude<T[K], undefined>
}

export type FixOptions = {
  autoMerge?: boolean | undefined
  autopilot?: boolean | undefined
  cwd?: string | undefined
  purls?: string[] | readonly string[] | undefined
  rangeStyle?: RangeStyle | undefined
  spinner?: Spinner | undefined
  test?: boolean | undefined
  testScript?: string | undefined
}

export type NormalizedFixOptions = StripUndefined<
  Required<Omit<FixOptions, 'spinner'>>
> &
  Pick<FixOptions, 'spinner'>
