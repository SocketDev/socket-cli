/** @fileoverview Simplified output formatter to DRY out repetitive output-*.mts files */

// @ts-expect-error - No type declarations available.
import chalkTable from 'chalk-table'
import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/lib/logger'

import { serializeResultJson } from '../output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mjs'


// Simple outputResult implementation
function outputResult<T>(
  result: CResult<T>,
  outputKind: OutputKind,
  handlers: {
    json: (res: CResult<T>) => string
    success: (data: T) => void
  },
): void {
  if (outputKind === 'json') {
    logger.log(handlers.json(result))
  } else if (result.ok) {
    handlers.success(result.data)
  } else {
    logger.error(result.message || 'Operation failed')
  }
}

/**
 * Table column definition for formatted output
 */
export interface TableColumn {
  field: string
  name: string
  transform?: (value: any) => string
}

/**
 * Options for simple output formatting
 */
export interface SimpleOutputOptions<T> {
  json?: (data: T) => any
  table?: {
    columns: TableColumn[]
    rows: (data: T) => any[]
  }
  text?: (data: T) => void
  title?: string
  emptyMessage?: string
}

/**
 * Generic output formatter that eliminates repetitive output-*.mts files
 */
export function simpleOutput<T>(
  result: CResult<T>,
  outputKind: OutputKind,
  options: SimpleOutputOptions<T>,
): void {
  const { emptyMessage = 'No data found', json, table, text, title } = options

  outputResult(result, outputKind, {
    json: (res: CResult<T>) => {
      if (!res.ok) {
        return serializeResultJson(res)
      }
      if (json) {
        return serializeResultJson({ ok: true, data: json(res.data) })
      }
      return serializeResultJson({ ok: true, data: res.data })
    },
    success: (data: T) => {
      // Show title if provided
      if (title) {
        logger.log(colors.cyan(title))
      }

      // Handle table output
      if (table && outputKind !== 'json') {
        const rows = table.rows(data)
        if (rows.length === 0) {
          logger.log(emptyMessage)
          return
        }

        const formattedRows = rows.map(row => {
          const formatted: any = {}
          for (const col of table.columns) {
            const value = row[col.field]
            formatted[col.field] = col.transform ? col.transform(value) : value
          }
          return formatted
        })

        logger.log(chalkTable({ columns: table.columns }, formattedRows))
        return
      }

      // Handle text output
      if (text) {
        text(data)
        return
      }

      // Default: log the data
      logger.log(data)
    },
  })
}

/**
 * Common table column definitions
 */
export const commonColumns = {
  id: { field: 'id', name: colors.magenta('ID') },
  name: { field: 'name', name: colors.magenta('Name') },
  description: { field: 'description', name: colors.magenta('Description') },
  status: {
    field: 'status',
    name: colors.magenta('Status'),
    transform: (v: string) =>
      v === 'active' ? colors.green(v) : colors.yellow(v),
  },
  created: {
    field: 'created_at',
    name: colors.magenta('Created'),
    transform: (v: string) => new Date(v).toLocaleDateString(),
  },
  updated: {
    field: 'updated_at',
    name: colors.magenta('Updated'),
    transform: (v: string) => new Date(v).toLocaleDateString(),
  },
  boolean: (field: string, label: string) => ({
    field,
    name: colors.magenta(label),
    transform: (v: boolean) => (v ? colors.green('✓') : colors.red('✗')),
  }),
}

/**
 * Pagination helper for list outputs
 */
export function outputPaginatedList<T>(
  result: CResult<T>,
  outputKind: OutputKind,
  pagination: {
    page: number
    perPage: number
    nextPage: number | null
    sort?: string
    direction?: string
  },
  tableOptions: {
    columns: TableColumn[]
    getRows: (data: T) => any[]
    emptyMessage?: string
  },
): void {
  simpleOutput(result, outputKind, {
    json: data => ({
      data,
      ...pagination,
    }),
    text: data => {
      // Show pagination info
      const { direction, nextPage, page, perPage, sort } = pagination
      logger.log(
        `Page: ${page}, Per page: ${perPage === Number.POSITIVE_INFINITY ? 'all' : perPage}` +
          (sort ? `, Sort: ${sort}` : '') +
          (direction ? `, Direction: ${direction}` : ''),
      )

      // Show table
      const rows = tableOptions.getRows(data)
      if (rows.length === 0) {
        logger.log(tableOptions.emptyMessage || 'No results found')
        return
      }

      const formattedRows = rows.map(row => {
        const formatted: any = {}
        for (const col of tableOptions.columns) {
          const value = row[col.field]
          formatted[col.field] = col.transform ? col.transform(value) : value
        }
        return formatted
      })

      logger.log(chalkTable({ columns: tableOptions.columns }, formattedRows))

      // Show next page hint
      if (nextPage !== null) {
        logger.log(`\nNext page: ${nextPage}`)
      }
    },
  })
}
