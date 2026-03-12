/**
 * Unit tests for GitHub constants.
 *
 * Purpose:
 * Tests the GitHub and GraphQL constants for Socket CLI.
 *
 * Test Coverage:
 * - GraphQL pagination constants
 * - PR state constants
 * - Repository constants
 *
 * Related Files:
 * - constants/github.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import {
  GQL_PAGE_SENTINEL,
  GQL_PR_STATE_CLOSED,
  GQL_PR_STATE_MERGED,
  GQL_PR_STATE_OPEN,
  SOCKET_CLI_GITHUB_REPO,
} from '../../../src/constants/github.mts'

describe('github constants', () => {
  describe('GraphQL pagination', () => {
    it('has GQL_PAGE_SENTINEL constant', () => {
      expect(GQL_PAGE_SENTINEL).toBe(100)
    })

    it('GQL_PAGE_SENTINEL is within GitHub API limits', () => {
      // GitHub GraphQL API typically limits to 100 items per page.
      expect(GQL_PAGE_SENTINEL).toBeLessThanOrEqual(100)
      expect(GQL_PAGE_SENTINEL).toBeGreaterThan(0)
    })
  })

  describe('PR state constants', () => {
    it('has GQL_PR_STATE_CLOSED constant', () => {
      expect(GQL_PR_STATE_CLOSED).toBe('CLOSED')
    })

    it('has GQL_PR_STATE_MERGED constant', () => {
      expect(GQL_PR_STATE_MERGED).toBe('MERGED')
    })

    it('has GQL_PR_STATE_OPEN constant', () => {
      expect(GQL_PR_STATE_OPEN).toBe('OPEN')
    })

    it('all PR states are uppercase', () => {
      expect(GQL_PR_STATE_CLOSED).toBe(GQL_PR_STATE_CLOSED.toUpperCase())
      expect(GQL_PR_STATE_MERGED).toBe(GQL_PR_STATE_MERGED.toUpperCase())
      expect(GQL_PR_STATE_OPEN).toBe(GQL_PR_STATE_OPEN.toUpperCase())
    })
  })

  describe('repository constants', () => {
    it('has SOCKET_CLI_GITHUB_REPO constant', () => {
      expect(SOCKET_CLI_GITHUB_REPO).toBe('socket-cli')
    })
  })
})
