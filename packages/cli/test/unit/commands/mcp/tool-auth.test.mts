/**
 * Unit tests for MCP tool token resolution.
 *
 * The two resolvers encode the port's central security property: an org-scoped
 * tool must never act as the deploy operator on behalf of an arbitrary caller.
 * `resolveScopedToolAuthToken` fails closed; `resolveToolAuthToken` (public,
 * non-tenant data) may fall back.
 *
 * Related Files: - src/commands/mcp/tool-auth.mts
 */

import { describe, expect, it } from 'vitest'

import {
  authRequiredToolResult,
  errorToolResult,
  resolveScopedToolAuthToken,
  resolveToolAuthToken,
  textToolResult,
} from '../../../../src/commands/mcp/tool-auth.mts'

// Spelled out rather than imported: an expected value built from the module
// under test would pass even if that module's wording regressed.
const EXPECTED_AUTH_REQUIRED_MSG =
  'Authentication is required. Run `socket login`, or set SOCKET_API_TOKEN, for stdio mode. In HTTP mode, connect through OAuth so the request carries your own Socket token.'

const localContext = {
  getApiToken: () => 'local_user_token',
  sharedApiToken: false,
}

const sharedContext = {
  getApiToken: () => 'operator_token',
  sharedApiToken: true,
}

const noTokenContext = {
  getApiToken: () => undefined,
  sharedApiToken: false,
}

describe('resolveToolAuthToken — public data', () => {
  it('prefers the per-request token', () => {
    expect(resolveToolAuthToken('request_token', localContext)).toBe(
      'request_token',
    )
  })

  it('falls back to the local configured token', () => {
    expect(resolveToolAuthToken(undefined, localContext)).toBe(
      'local_user_token',
    )
  })

  it('falls back to a shared operator token — package scores are not tenant data', () => {
    expect(resolveToolAuthToken(undefined, sharedContext)).toBe(
      'operator_token',
    )
  })

  it('yields undefined when no token exists anywhere', () => {
    expect(resolveToolAuthToken(undefined, noTokenContext)).toBeUndefined()
  })

  it('treats an empty per-request token as absent', () => {
    expect(resolveToolAuthToken('', localContext)).toBe('local_user_token')
  })
})

describe('resolveScopedToolAuthToken — org-scoped data', () => {
  it('prefers the per-request token', () => {
    expect(resolveScopedToolAuthToken('request_token', localContext)).toBe(
      'request_token',
    )
  })

  it('falls back to the configured token when it is the local user’s own', () => {
    expect(resolveScopedToolAuthToken(undefined, localContext)).toBe(
      'local_user_token',
    )
  })

  it('fails closed rather than acting as the operator when the token is shared', () => {
    expect(resolveScopedToolAuthToken(undefined, sharedContext)).toBeUndefined()
  })

  it('still honors a per-request token on a shared-token server', () => {
    expect(resolveScopedToolAuthToken('caller_token', sharedContext)).toBe(
      'caller_token',
    )
  })

  it('yields undefined when no token exists anywhere', () => {
    expect(
      resolveScopedToolAuthToken(undefined, noTokenContext),
    ).toBeUndefined()
  })
})

describe('tool result helpers', () => {
  it('marks an error result', () => {
    expect(errorToolResult('nope')).toEqual({
      content: [{ text: 'nope', type: 'text' }],
      isError: true,
    })
  })

  it('leaves isError unset on a success result', () => {
    expect(textToolResult('fine')).toEqual({
      content: [{ text: 'fine', type: 'text' }],
    })
  })

  it('returns the shared auth-required text', () => {
    const result = authRequiredToolResult()
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toBe(EXPECTED_AUTH_REQUIRED_MSG)
  })

  it('points the user at socket login rather than leaking configuration detail', () => {
    expect(authRequiredToolResult().content[0]!.text).toContain('socket login')
  })
})
