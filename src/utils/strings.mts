export function camelToKebab(str: string): string {
  return str === '' ? '' : str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}
