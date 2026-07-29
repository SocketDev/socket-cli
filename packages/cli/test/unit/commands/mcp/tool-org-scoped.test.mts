/**
 * Unit tests for the three org-scoped MCP tools: organizations, alerts, and
 * threat_feed.
 *
 * These tools reach the Socket API with the caller's token, so the tests focus
 * on the boundary: the org slug is validated before any request is built, a
 * shared operator token is refused, and the filters a caller sends are mapped
 * onto documented query parameters rather than passed through.
 *
 * Related Files: - src/commands/mcp/tool-organizations.mts -
 * src/commands/mcp/tool-alerts.mts - src/commands/mcp/tool-threat-feed.mts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defineAlertsTool } from '../../../../src/commands/mcp/tool-alerts.mts'
import { defineOrganizationsTool } from '../../../../src/commands/mcp/tool-organizations.mts'
import {
  buildThreatFeedQueryParams,
  defineThreatFeedTool,
} from '../../../../src/commands/mcp/tool-threat-feed.mts'

const {
  mockFetchSocketAlerts,
  mockFetchSocketOrganizations,
  mockFetchSocketThreatFeed,
} = vi.hoisted(() => ({
  mockFetchSocketAlerts: vi.fn(),
  mockFetchSocketOrganizations: vi.fn(),
  mockFetchSocketThreatFeed: vi.fn(),
}))

vi.mock(import('../../../../src/commands/mcp/lib/socket-api.mts'), () => ({
  fetchSocketAlerts: mockFetchSocketAlerts,
  fetchSocketOrganizations: mockFetchSocketOrganizations,
  fetchSocketThreatFeed: mockFetchSocketThreatFeed,
}))

const localContext = {
  getApiToken: () => 'local_user_token',
  sharedApiToken: false,
}

const sharedContext = {
  getApiToken: () => 'operator_token',
  sharedApiToken: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchSocketAlerts.mockResolvedValue({ results: [] })
  mockFetchSocketOrganizations.mockResolvedValue({ organizations: {} })
  mockFetchSocketThreatFeed.mockResolvedValue({ results: [] })
})

describe('organizations tool', () => {
  const tool = defineOrganizationsTool()

  it('returns the API payload as formatted JSON', async () => {
    mockFetchSocketOrganizations.mockResolvedValue({
      organizations: { '1': { name: 'acme' } },
    })
    const result = await tool.handler({}, {}, localContext)
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      organizations: { '1': { name: 'acme' } },
    })
  })

  it('passes the per-request token through', async () => {
    await tool.handler({}, { authInfo: { token: 'caller' } }, localContext)
    expect(mockFetchSocketOrganizations).toHaveBeenCalledWith('caller')
  })

  it('refuses to act as the operator on a shared-token server', async () => {
    const result = await tool.handler({}, {}, sharedContext)
    expect(mockFetchSocketOrganizations).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Authentication is required')
  })

  it('surfaces an API failure as an error result', async () => {
    mockFetchSocketOrganizations.mockRejectedValue(new Error('HTTP 403'))
    const result = await tool.handler({}, {}, localContext)
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('HTTP 403')
  })
})

describe('alerts tool', () => {
  const tool = defineAlertsTool()

  it('rejects an org slug that could smuggle a path segment', async () => {
    const result = await tool.handler(
      { org_slug: '../../admin' },
      {},
      localContext,
    )
    expect(mockFetchSocketAlerts).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('`org_slug`')
  })

  it('rejects a missing org slug before touching the network', async () => {
    const result = await tool.handler({}, {}, localContext)
    expect(mockFetchSocketAlerts).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('checks the slug before the token, so a bad slug never prompts for auth', async () => {
    const result = await tool.handler(
      { org_slug: 'bad slug' },
      {},
      sharedContext,
    )
    expect(result.content[0]!.text).toContain('`org_slug`')
  })

  it('forwards the caller filters and defaults per_page', async () => {
    await tool.handler(
      {
        alert_type: 'usesEval',
        artifact_name: 'lodash',
        artifact_type: 'npm',
        category: 'supplyChainRisk',
        org_slug: 'acme',
        severity: 'high,critical',
        status: 'open',
      },
      {},
      localContext,
    )
    expect(mockFetchSocketAlerts).toHaveBeenCalledWith(
      'local_user_token',
      'acme',
      expect.objectContaining({
        alertType: 'usesEval',
        artifactName: 'lodash',
        artifactType: 'npm',
        category: 'supplyChainRisk',
        perPage: 100,
        severity: 'high,critical',
        status: 'open',
      }),
    )
  })

  it('honors an explicit per_page', async () => {
    await tool.handler({ org_slug: 'acme', per_page: 5 }, {}, localContext)
    expect(mockFetchSocketAlerts.mock.calls[0]![2].perPage).toBe(5)
  })

  it('refuses a shared operator token', async () => {
    const result = await tool.handler({ org_slug: 'acme' }, {}, sharedContext)
    expect(mockFetchSocketAlerts).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })
})

describe('threat_feed tool', () => {
  const tool = defineThreatFeedTool()

  it('rejects an invalid org slug', async () => {
    const result = await tool.handler(
      { org_slug: 'org/../other' },
      {},
      localContext,
    )
    expect(mockFetchSocketThreatFeed).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  it('forwards mapped query parameters', async () => {
    await tool.handler(
      { ecosystem: 'npm', filter: 'mal', org_slug: 'acme' },
      {},
      localContext,
    )
    expect(mockFetchSocketThreatFeed).toHaveBeenCalledWith(
      'local_user_token',
      'acme',
      { ecosystem: 'npm', filter: 'mal' },
    )
  })

  it('refuses a shared operator token', async () => {
    const result = await tool.handler({ org_slug: 'acme' }, {}, sharedContext)
    expect(mockFetchSocketThreatFeed).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })
})

describe('buildThreatFeedQueryParams', () => {
  it('omits every field the caller left unset', () => {
    expect(buildThreatFeedQueryParams({ org_slug: 'acme' })).toEqual({})
  })

  it('renames cursor to the endpoint parameter', () => {
    expect(buildThreatFeedQueryParams({ cursor: 'abc' })).toEqual({
      page_cursor: 'abc',
    })
  })

  it('forwards a false boolean rather than dropping it', () => {
    expect(buildThreatFeedQueryParams({ is_human_reviewed: false })).toEqual({
      is_human_reviewed: false,
    })
  })

  it('forwards the paging and sorting fields', () => {
    expect(
      buildThreatFeedQueryParams({
        direction: 'asc',
        per_page: 10,
        sort: 'created_at',
      }),
    ).toEqual({ direction: 'asc', per_page: 10, sort: 'created_at' })
  })

  it('drops a wrong-typed value instead of forwarding it', () => {
    expect(buildThreatFeedQueryParams({ per_page: 'lots' })).toEqual({})
  })
})
