/**
 * @file Type declarations for chalk-table module.
 */

declare module 'chalk-table' {
  interface TableOptions {
    columns?:
      | Array<{
          field: string
          name?: string | undefined
        }>
      | undefined
    leftPad?: number | undefined
    intersectionCharacter?: string | undefined
  }

  function chalkTable(options: TableOptions | null, data: any[]): string

  export = chalkTable
}
