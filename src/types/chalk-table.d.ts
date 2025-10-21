/**
 * @fileoverview Type declarations for chalk-table module.
 */

declare module 'chalk-table' {
  interface TableOptions {
    columns?: Array<{
      field: string
      name?: string
    }>
    leftPad?: number
    intersectionCharacter?: string
  }

  function chalkTable(options: TableOptions | null, data: any[]): string

  export = chalkTable
}
