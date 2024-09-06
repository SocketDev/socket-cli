export const { compare: localCompare } = new Intl.Collator()

export function toSortedObject<T extends { [key: string]: any }>(
  object: T,
  comparator = localCompare
): T {
  return <T>(
    Object.fromEntries(
      Object.entries(object).sort((a, b) => comparator(a[0], b[0]))
    )
  )
}
