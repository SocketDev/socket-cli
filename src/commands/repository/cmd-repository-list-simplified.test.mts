/** @fileoverview Simplified tests for repository list command */

import {
  buildCommandTests,
  commonTests,
  mockApiResponse,
} from '../../test/test-builder.mts'

const mockRepos = [
  {
    id: '1',
    name: 'test-repo-1',
    visibility: 'public',
    default_branch: 'main',
    archived: false,
  },
  {
    id: '2',
    name: 'test-repo-2',
    visibility: 'private',
    default_branch: 'master',
    archived: true,
  },
]

buildCommandTests(
  'cmd-repository-list',
  {
    commandPath: './cmd-repository-list-simplified.mts',
    commandName: 'cmdRepositoryListSimplified',
    parentCommand: 'socket repo',
    mockConfig: {
      defaultOrg: 'test-org',
    },
  },
  [
    // Standard test cases
    commonTests.help('list'),
    commonTests.dryRun(),
    commonTests.jsonOutput(),
    commonTests.missingAuth(),

    // Custom test cases
    {
      name: 'should list repositories',
      args: [],
      setup: () => {
        mockApiResponse(global.mockSdk, 'getOrgRepoList', mockRepos)
      },
      expectedOutput: ['test-repo-1', 'test-repo-2'],
    },

    {
      name: 'should handle pagination',
      args: [],
      flags: { page: 2, perPage: 10 },
      setup: () => {
        mockApiResponse(global.mockSdk, 'getOrgRepoList', mockRepos)
      },
      expectedOutput: ['Page: 2', 'Per page: 10'],
    },

    {
      name: 'should handle --all flag',
      args: [],
      flags: { all: true },
      setup: () => {
        mockApiResponse(global.mockSdk, 'getOrgRepoList', mockRepos)
      },
      expectedOutput: 'Per page: all',
    },

    {
      name: 'should validate direction',
      args: [],
      flags: { direction: 'invalid' },
      expectedError: 'Direction must be "asc" or "desc"',
      expectedExitCode: 1,
    },

    {
      name: 'should handle empty results',
      args: [],
      setup: () => {
        mockApiResponse(global.mockSdk, 'getOrgRepoList', [])
      },
      expectedOutput: 'No repositories found',
    },

    {
      name: 'should respect custom org',
      args: [],
      flags: { org: 'custom-org' },
      setup: () => {
        mockApiResponse(global.mockSdk, 'getOrgRepoList', mockRepos)
      },
      validate: stubs => {
        expect(stubs.sdk.getOrgRepoList).toHaveBeenCalledWith(
          'custom-org',
          expect.any(Object),
        )
      },
    },
  ],
)
