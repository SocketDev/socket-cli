/**
 * Unit tests for simple output utilities.
 *
 * Purpose:
 * Tests the simplified output formatter utility.
 *
 * Test Coverage:
 * - simpleOutput function
 * - outputPaginatedList function
 * - commonColumns helpers
 * - JSON, table, and text output modes
 *
 * Related Files:
 * - src/utils/terminal/simple-output.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock chalk-table.
const mockChalkTable = vi.hoisted(() => vi.fn(() => '<table>'))
vi.mock('chalk-table', () => ({
  default: mockChalkTable,
}))

// Mock yoctocolors.
vi.mock('yoctocolors-cjs', () => ({
  default: {
    cyan: (s: string) => `[cyan]${s}[/cyan]`,
    magenta: (s: string) => `[magenta]${s}[/magenta]`,
    green: (s: string) => `[green]${s}[/green]`,
    yellow: (s: string) => `[yellow]${s}[/yellow]`,
    red: (s: string) => `[red]${s}[/red]`,
  },
}))

// Mock logger.
const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}))
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock result serializer.
vi.mock('../../../../src/utils/output/result-json.mjs', () => ({
  serializeResultJson: (result: unknown) => JSON.stringify(result, null, 2),
}))

import {
  commonColumns,
  outputPaginatedList,
  simpleOutput,
} from '../../../../src/utils/terminal/simple-output.mts'

import type { CResult } from '../../../../src/types.mts'

describe('simple-output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('simpleOutput', () => {
    describe('JSON output', () => {
      it('outputs success result as JSON', () => {
        const result: CResult<{ name: string }> = {
          ok: true,
          data: { name: 'test' },
        }

        simpleOutput(result, 'json', {})

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": true'),
        )
      })

      it('outputs error result as JSON', () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Failed',
        }

        simpleOutput(result, 'json', {})

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false'),
        )
      })

      it('uses custom JSON transformer when provided', () => {
        const result: CResult<{ items: string[] }> = {
          ok: true,
          data: { items: ['a', 'b'] },
        }

        simpleOutput(result, 'json', {
          json: data => ({ count: data.items.length }),
        })

        expect(mockLogger.log).toHaveBeenCalledWith(
          expect.stringContaining('"count": 2'),
        )
      })
    })

    describe('Text output', () => {
      it('displays title when provided', () => {
        const result: CResult<string> = {
          ok: true,
          data: 'test data',
        }

        simpleOutput(result, 'text', {
          title: 'My Title',
        })

        expect(mockLogger.log).toHaveBeenCalledWith('[cyan]My Title[/cyan]')
      })

      it('uses custom text handler when provided', () => {
        const textHandler = vi.fn()
        const result: CResult<{ value: number }> = {
          ok: true,
          data: { value: 42 },
        }

        simpleOutput(result, 'text', {
          text: textHandler,
        })

        expect(textHandler).toHaveBeenCalledWith({ value: 42 })
      })

      it('displays empty message when table has no rows', () => {
        const result: CResult<string[]> = {
          ok: true,
          data: [],
        }

        simpleOutput(result, 'text', {
          table: {
            columns: [{ field: 'name', name: 'Name' }],
            rows: data => data.map(name => ({ name })),
          },
          emptyMessage: 'No items found',
        })

        expect(mockLogger.log).toHaveBeenCalledWith('No items found')
      })

      it('renders table when data has rows', () => {
        const result: CResult<Array<{ name: string }>> = {
          ok: true,
          data: [{ name: 'item1' }, { name: 'item2' }],
        }

        simpleOutput(result, 'text', {
          table: {
            columns: [{ field: 'name', name: 'Name' }],
            rows: data => data,
          },
        })

        expect(mockChalkTable).toHaveBeenCalled()
        expect(mockLogger.log).toHaveBeenCalledWith('<table>')
      })

      it('applies column transforms', () => {
        const result: CResult<Array<{ value: number }>> = {
          ok: true,
          data: [{ value: 100 }],
        }

        simpleOutput(result, 'text', {
          table: {
            columns: [
              {
                field: 'value',
                name: 'Value',
                transform: (v: number) => `$${v}`,
              },
            ],
            rows: data => data,
          },
        })

        const tableCall = mockChalkTable.mock.calls[0]
        expect(tableCall![1]![0].value).toBe('$100')
      })

      it('logs error message on failure', () => {
        const result: CResult<unknown> = {
          ok: false,
          message: 'Something went wrong',
        }

        simpleOutput(result, 'text', {})

        expect(mockLogger.error).toHaveBeenCalledWith('Something went wrong')
      })

      it('logs default error message when no message provided', () => {
        const result: CResult<unknown> = {
          ok: false,
        } as any

        simpleOutput(result, 'text', {})

        expect(mockLogger.error).toHaveBeenCalledWith('Operation failed')
      })

      it('logs data directly when no handlers provided', () => {
        const result: CResult<string> = {
          ok: true,
          data: 'direct output',
        }

        simpleOutput(result, 'text', {})

        expect(mockLogger.log).toHaveBeenCalledWith('direct output')
      })
    })
  })

  describe('commonColumns', () => {
    it('provides id column', () => {
      expect(commonColumns.id.field).toBe('id')
      expect(commonColumns.id.name).toContain('ID')
    })

    it('provides name column', () => {
      expect(commonColumns.name.field).toBe('name')
      expect(commonColumns.name.name).toContain('Name')
    })

    it('provides status column with transform', () => {
      expect(commonColumns.status.field).toBe('status')
      expect(commonColumns.status.transform?.('active')).toContain('green')
      expect(commonColumns.status.transform?.('inactive')).toContain('yellow')
    })

    it('provides created column with date transform', () => {
      expect(commonColumns.created.field).toBe('created_at')
      const result = commonColumns.created.transform?.('2025-01-15T00:00:00Z')
      expect(result).toBeDefined()
    })

    it('provides boolean column factory', () => {
      const col = commonColumns.boolean('enabled', 'Enabled')
      expect(col.field).toBe('enabled')
      expect(col.name).toContain('Enabled')
      expect(col.transform?.(true)).toContain('green')
      expect(col.transform?.(false)).toContain('red')
    })
  })

  describe('outputPaginatedList', () => {
    it('outputs JSON with pagination info', () => {
      const result: CResult<string[]> = {
        ok: true,
        data: ['item1', 'item2'],
      }

      outputPaginatedList(result, 'json', {
        page: 1,
        perPage: 10,
        nextPage: 2,
        sort: 'name',
        direction: 'asc',
      }, {
        columns: [{ field: 'name', name: 'Name' }],
        getRows: data => data.map(name => ({ name })),
      })

      const loggedJson = mockLogger.log.mock.calls[0]![0]
      expect(loggedJson).toContain('"page": 1')
      expect(loggedJson).toContain('"perPage": 10')
      expect(loggedJson).toContain('"nextPage": 2')
    })

    it('outputs text with pagination info', () => {
      const result: CResult<string[]> = {
        ok: true,
        data: ['item1'],
      }

      outputPaginatedList(result, 'text', {
        page: 1,
        perPage: 10,
        nextPage: null,
        sort: 'name',
        direction: 'asc',
      }, {
        columns: [{ field: 'name', name: 'Name' }],
        getRows: data => data.map(name => ({ name })),
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Page: 1'),
      )
    })

    it('shows infinity as all in text mode', () => {
      const result: CResult<string[]> = {
        ok: true,
        data: ['item1'],
      }

      outputPaginatedList(result, 'text', {
        page: 1,
        perPage: Number.POSITIVE_INFINITY,
        nextPage: null,
      }, {
        columns: [{ field: 'name', name: 'Name' }],
        getRows: data => data.map(name => ({ name })),
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Per page: all'),
      )
    })

    it('shows empty message when no rows', () => {
      const result: CResult<string[]> = {
        ok: true,
        data: [],
      }

      outputPaginatedList(result, 'text', {
        page: 1,
        perPage: 10,
        nextPage: null,
      }, {
        columns: [{ field: 'name', name: 'Name' }],
        getRows: () => [],
        emptyMessage: 'Nothing here',
      })

      expect(mockLogger.log).toHaveBeenCalledWith('Nothing here')
    })

    it('shows next page hint when nextPage is set', () => {
      const result: CResult<string[]> = {
        ok: true,
        data: ['item1'],
      }

      outputPaginatedList(result, 'text', {
        page: 1,
        perPage: 10,
        nextPage: 2,
      }, {
        columns: [{ field: 'name', name: 'Name' }],
        getRows: data => data.map(name => ({ name })),
      })

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Next page: 2'),
      )
    })
  })
})
