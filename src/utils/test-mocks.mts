/**
 * Reusable mocking utilities for Socket CLI tests.
 * Provides comprehensive mocking for Socket SDK API calls and common CLI dependencies.
 */

import { vi } from 'vitest'

import type { SocketSdk } from '@socketsecurity/sdk'

/**
 * Default mock responses for Socket SDK API calls.
 * These can be overridden per-test as needed.
 */
export const DEFAULT_MOCK_RESPONSES = {
  organizations: {
    ok: true,
    data: {
      organizations: {
        'test-org': {
          name: 'test-org',
          plan: 'pro',
          id: 'test-org-id',
        },
      },
    },
  },
  orgSlug: {
    ok: true,
    data: 'test-org',
    message: 'Retrieved default org from mocked API',
  },
  fixResult: {
    ok: true,
    data: {
      results: [],
      success: true,
    },
  },
} as const

/**
 * Mock the Socket SDK with default responses.
 * Call this in test files that need Socket API mocking.
 */
export function mockSocketSdk() {
  // Mock the organization-related API calls
  vi.mock('../commands/ci/fetch-default-org-slug.mts', () => ({
    getDefaultOrgSlug: vi
      .fn()
      .mockResolvedValue(DEFAULT_MOCK_RESPONSES.orgSlug),
  }))

  vi.mock('../commands/organization/fetch-organization-list.mts', () => ({
    fetchOrganization: vi
      .fn()
      .mockResolvedValue(DEFAULT_MOCK_RESPONSES.organizations),
  }))

  // Mock the SDK setup utilities
  vi.mock('../utils/sdk.mts', () => ({
    setupSdk: vi.fn().mockResolvedValue({
      ok: true,
      data: createMockSocketSdk(),
    }),
    getDefaultApiToken: vi.fn().mockReturnValue('mock-token'),
  }))

  // Mock the API utility functions
  vi.mock('../utils/api.mts', async importOriginal => {
    const actual = (await importOriginal()) as any
    return {
      ...actual,
      handleApiCall: vi
        .fn()
        .mockResolvedValue(DEFAULT_MOCK_RESPONSES.organizations),
    }
  })

  // Mock fix-specific functions
  vi.mock('../commands/fix/handle-fix.mts', async importOriginal => {
    const actual = (await importOriginal()) as any
    return {
      ...actual,
      handleFix: vi.fn().mockResolvedValue(undefined),
    }
  })

  vi.mock('../commands/fix/coana-fix.mts', () => ({
    coanaFix: vi.fn().mockResolvedValue(DEFAULT_MOCK_RESPONSES.fixResult),
  }))
}

/**
 * Create a mock Socket SDK instance with all methods stubbed.
 */
export function createMockSocketSdk(): SocketSdk {
  return {
    getOrganizations: vi
      .fn()
      .mockResolvedValue(DEFAULT_MOCK_RESPONSES.organizations),
    // Add more SDK methods as needed
  } as any as SocketSdk
}

/**
 * Override specific mock responses for custom test scenarios.
 * Call this after mockSocketSdk() to customize specific responses.
 */
export async function overrideMockResponse(
  mockName: keyof typeof DEFAULT_MOCK_RESPONSES,
  response: any,
) {
  const mocks = vi.hoisted(() => ({ mocks: new Map() }))
  mocks.mocks.set(mockName, response)

  // Update the appropriate mock based on the mockName
  switch (mockName) {
    case 'organizations': {
      const fetchOrgMock = await import(
        '../commands/organization/fetch-organization-list.mts'
      )
      vi.mocked(fetchOrgMock.fetchOrganization).mockResolvedValue(response)
      break
    }
    case 'orgSlug': {
      const orgSlugMock = await import(
        '../commands/ci/fetch-default-org-slug.mts'
      )
      vi.mocked(orgSlugMock.getDefaultOrgSlug).mockResolvedValue(response)
      break
    }
    case 'fixResult': {
      const fixMock = await import('../commands/fix/coana-fix.mts')
      vi.mocked(fixMock.coanaFix).mockResolvedValue(response)
      break
    }
  }
}

/**
 * Reset all mocks to their default state.
 * Useful in beforeEach/afterEach hooks.
 */
export function resetMocks() {
  vi.clearAllMocks()
}
