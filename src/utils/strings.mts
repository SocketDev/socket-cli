export function stringJoinWithSeparateFinalSeparator(
  list: string[],
  separator: string = ' and ',
): string {
  const values = list.filter(Boolean)
  const { length } = values
  if (!length) {
    return ''
  }
  if (length === 1) {
    return values[0]!
  }
  const finalValue = values.pop()
  return `${values.join(', ')}${separator}${finalValue}`
}
