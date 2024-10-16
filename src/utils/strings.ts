export function isNonEmptyString(value: any): value is string {
  return typeof value === 'string' && value.length > 0
}
