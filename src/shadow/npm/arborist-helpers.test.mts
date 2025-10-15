import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DiffAction } from './arborist/types.mts'
import {
  getAlertsMapFromArborist,
  getDetailsFromDiff,
} from './arborist-helpers.mts'

import type { ArboristInstance, Diff, NodeClass } from './arborist/types.mts'
import type { PackageDetail } from './arborist-helpers.mts'
import type { AlertsByPurl } from '../../utils/socket/package-alert.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

// Mock all dependencies.
const mockGetAlertsMapFromPurls = vi.hoisted(() => vi.fn())
const mockIdToNpmPurl = vi.hoisted(() => vi.fn())
const mockParseUrl = vi.hoisted(() => vi.fn())
const mockToFilterConfig = vi.hoisted(() => vi.fn())

vi.mock('../../utils/socket/alerts.mts', () => ({
  getAlertsMapFromPurls: mockGetAlertsMapFromPurls,
}))

vi.mock('../../utils/spec.mts', () => ({
  idToNpmPurl: mockIdToNpmPurl,
}))

vi.mock('@socketsecurity/registry/lib/url', () => ({
  parseUrl: mockParseUrl,
}))

vi.mock('../../utils/validation/filter-config.mts', () => ({
  toFilterConfig: mockToFilterConfig,
}))

vi.mock('../../constants.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    default: {
      ...actual?.default,
      NPM_REGISTRY_URL: 'https://registry.npmjs.org',
      LOOP_SENTINEL: 100_000,
    },
  }
})

describe('arborist-helpers', () => {
  const mockSpinner: Spinner = {
    stop: vi.fn(),
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  } as any

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockGetAlertsMapFromPurls.mockResolvedValue(new Map())
    mockIdToNpmPurl.mockImplementation((pkgid: string) => `pkg:npm/${pkgid}`)
    mockParseUrl.mockImplementation((url: string) => ({
      origin: url.startsWith('https://registry.npmjs.org')
        ? 'https://registry.npmjs.org'
        : 'https://example.com',
    }))
    mockToFilterConfig.mockImplementation((filter: any) => {
      return filter ?? { actions: ['error', 'monitor', 'warn'] }
    })
  })

  describe('getAlertsMapFromArborist', () => {
    it('should get alerts map from arborist with package details', async () => {
      const mockNode: NodeClass = {
        pkgid: 'lodash@4.17.21',
        package: { name: 'lodash', version: '4.17.21' },
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      } as any

      const needInfoOn: PackageDetail[] = [{ node: mockNode }]

      const mockArb: ArboristInstance = {
        actualTree: {
          overrides: {
            children: new Map([['lodash', { value: '^4.0.0' }]]),
          },
        },
        idealTree: null,
        loadActual: vi.fn(),
      } as any

      const expectedMap = new Map([
        [
          'pkg:npm/lodash@4.17.21',
          [{ action: 'warn', description: 'Test alert' }],
        ],
      ])
      mockGetAlertsMapFromPurls.mockResolvedValue(expectedMap)

      const result = await getAlertsMapFromArborist(mockArb, needInfoOn, {
        apiToken: 'test-token',
        spinner: mockSpinner,
      })

      expect(mockIdToNpmPurl).toHaveBeenCalledWith('lodash@4.17.21')
      expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
        ['pkg:npm/lodash@4.17.21'],
        {
          apiToken: 'test-token',
          consolidate: false,
          filter: { actions: ['error', 'monitor', 'warn'] },
          nothrow: false,
          overrides: { lodash: '^4.0.0' },
          spinner: mockSpinner,
        },
      )
      expect(result).toBe(expectedMap)
    })

    it('should handle arborist without actualTree', async () => {
      const mockNode: NodeClass = {
        pkgid: 'axios@1.0.0',
        package: { name: 'axios', version: '1.0.0' },
      } as any

      const needInfoOn: PackageDetail[] = [{ node: mockNode }]

      const mockArb: ArboristInstance = {
        actualTree: null,
        idealTree: null,
        loadActual: vi.fn().mockResolvedValue({
          overrides: { children: new Map() },
        }),
      } as any

      await getAlertsMapFromArborist(mockArb, needInfoOn)

      expect(mockArb.loadActual).toHaveBeenCalled()
      expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
        ['pkg:npm/axios@1.0.0'],
        expect.objectContaining({
          overrides: {},
        }),
      )
    })

    it('should handle arborist without overrides', async () => {
      const mockNode: NodeClass = {
        pkgid: 'react@18.0.0',
        package: { name: 'react', version: '18.0.0' },
      } as any

      const needInfoOn: PackageDetail[] = [{ node: mockNode }]

      const mockArb: ArboristInstance = {
        actualTree: { overrides: null },
        idealTree: null,
        loadActual: vi.fn(),
      } as any

      await getAlertsMapFromArborist(mockArb, needInfoOn)

      expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
        ['pkg:npm/react@18.0.0'],
        expect.not.objectContaining({
          overrides: expect.anything(),
        }),
      )
    })
  })

  describe('getDetailsFromDiff', () => {
    it('should return empty array when diff is null', () => {
      const result = getDetailsFromDiff(null)

      expect(result).toEqual([])
    })

    it('should extract package details from ADD diff action', () => {
      const mockNode: NodeClass = {
        package: { name: 'lodash', version: '4.17.21' },
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      } as any

      const mockDiff: Diff = {
        action: DiffAction.add,
        actual: null,
        ideal: mockNode,
        children: [],
      } as any

      const mockRootDiff: Diff = {
        action: null,
        children: [mockDiff],
        unchanged: [],
      } as any

      const result = getDetailsFromDiff(mockRootDiff)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        node: mockNode,
        existing: undefined,
      })
    })

    it('should extract package details from CHANGE diff action with version change', () => {
      const oldNode: NodeClass = {
        package: { name: 'lodash', version: '4.17.20' },
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz',
      } as any

      const newNode: NodeClass = {
        package: { name: 'lodash', version: '4.17.21' },
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      } as any

      const mockDiff: Diff = {
        action: DiffAction.change,
        actual: oldNode,
        ideal: newNode,
        children: [],
      } as any

      const mockRootDiff: Diff = {
        action: null,
        children: [mockDiff],
        unchanged: [],
      } as any

      const result = getDetailsFromDiff(mockRootDiff)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        node: newNode,
        existing: oldNode,
      })
    })

    it('should skip CHANGE diff action without version change', () => {
      const sameNode: NodeClass = {
        package: { name: 'lodash', version: '4.17.21' },
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      } as any

      const mockDiff: Diff = {
        action: DiffAction.change,
        actual: sameNode,
        ideal: sameNode,
        children: [],
      } as any

      const mockRootDiff: Diff = {
        action: null,
        children: [mockDiff],
        unchanged: [],
      } as any

      const result = getDetailsFromDiff(mockRootDiff)

      expect(result).toHaveLength(0)
    })

    it('should skip REMOVE diff action', () => {
      const oldNode: NodeClass = {
        package: { name: 'lodash', version: '4.17.21' },
        resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      } as any

      const mockDiff: Diff = {
        action: DiffAction.remove,
        actual: oldNode,
        ideal: null,
        children: [],
      } as any

      const mockRootDiff: Diff = {
        action: null,
        children: [mockDiff],
        unchanged: [],
      } as any

      const result = getDetailsFromDiff(mockRootDiff)

      expect(result).toHaveLength(0)
    })

    it('should filter out packages from unknown origins when unknownOrigin is false', () => {
      const mockNode: NodeClass = {
        package: { name: 'private-pkg', version: '1.0.0' },
        resolved: 'https://private-registry.com/package.tgz',
      } as any

      const mockDiff: Diff = {
        action: DiffAction.add,
        actual: null,
        ideal: mockNode,
        children: [],
      } as any

      const mockRootDiff: Diff = {
        action: null,
        children: [mockDiff],
        unchanged: [],
      } as any

      mockToFilterConfig.mockReturnValue({
        existing: false,
        unknownOrigin: false,
      })
      mockParseUrl.mockReturnValue({ origin: 'https://private-registry.com' })

      const result = getDetailsFromDiff(mockRootDiff, {
        filter: { unknownOrigin: false },
      })

      expect(result).toHaveLength(0)
    })

    it('should include existing packages when existing filter is true', () => {
      const existingNode: NodeClass = {
        package: { name: 'existing-pkg', version: '1.0.0' },
        resolved: 'https://registry.npmjs.org/existing-pkg.tgz',
      } as any

      const mockRootDiff: Diff = {
        action: null,
        children: [],
        unchanged: [existingNode],
      } as any

      mockToFilterConfig.mockReturnValue({
        existing: true,
        unknownOrigin: true,
      })

      const result = getDetailsFromDiff(mockRootDiff, {
        filter: { existing: true },
      })

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        node: existingNode,
        existing: existingNode,
      })
    })

    it('should handle nested diff children correctly', () => {
      const parentNode: NodeClass = {
        package: { name: 'parent', version: '1.0.0' },
        resolved: 'https://registry.npmjs.org/parent.tgz',
      } as any

      const childNode: NodeClass = {
        package: { name: 'child', version: '2.0.0' },
        resolved: 'https://registry.npmjs.org/child.tgz',
      } as any

      const childDiff: Diff = {
        action: DiffAction.add,
        actual: null,
        ideal: childNode,
        children: [],
      } as any

      const parentDiff: Diff = {
        action: DiffAction.add,
        actual: null,
        ideal: parentNode,
        children: [childDiff],
      } as any

      const mockRootDiff: Diff = {
        action: null,
        children: [parentDiff],
        unchanged: [],
      } as any

      const result = getDetailsFromDiff(mockRootDiff)

      expect(result).toHaveLength(2)
      expect(result.map(d => d.node.package.name)).toEqual(['parent', 'child'])
    })

    it('should throw error when infinite loop is detected', () => {
      const mockNode: NodeClass = {
        package: { name: 'test', version: '1.0.0' },
        resolved: 'https://registry.npmjs.org/test.tgz',
      } as any

      // Create a large number of children to trigger loop sentinel.
      const children: Diff[] = []
      for (let i = 0; i < 100_001; i++) {
         
        children.push({
          action: DiffAction.add,
          actual: null,
          ideal: mockNode,
          children: [],
        } as any)
      }

      const mockRootDiff: Diff = {
        action: null,
        children,
        unchanged: [],
      } as any

      expect(() => getDetailsFromDiff(mockRootDiff)).toThrow(
        'Detected infinite loop while walking Arborist diff.',
      )
    })
  })
})
