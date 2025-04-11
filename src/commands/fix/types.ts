import type { Spinner } from '@socketsecurity/registry/lib/spinner'

type StripUndefined<T> = {
  [K in keyof T]-?: Exclude<T[K], undefined>
}

export type RangeStyle =
  | 'caret'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'pin'
  | 'preserve'
  | 'tilde'

export type FixOptions = {
  autoMerge?: boolean | undefined
  autoPilot?: boolean | undefined
  cwd?: string | undefined
  rangeStyle?: RangeStyle | undefined
  spinner?: Spinner | undefined
  test?: boolean | undefined
  testScript?: string | undefined
}

export type NormalizedFixOptions = StripUndefined<
  Required<Omit<FixOptions, 'spinner'>>
> &
  Pick<FixOptions, 'spinner'>
