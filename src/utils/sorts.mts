let naturalCompareFn: ((a: string, b: string) => number) | undefined

export function naturalCompare(a: string, b: string): number {
  naturalCompareFn ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
  }).compare
  return naturalCompareFn(a, b)
}
