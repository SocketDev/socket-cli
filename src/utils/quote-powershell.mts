/** Quote a value as a PowerShell single-quoted string literal. */
export function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
