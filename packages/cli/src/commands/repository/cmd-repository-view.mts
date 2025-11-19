import { handleViewRepo } from './handle-view-repo.mts'
import { createRepositoryCommand } from './repository-command-factory.mts'

export const CMD_NAME = 'view'

export const cmdRepositoryView = createRepositoryCommand({
  commandName: CMD_NAME,
  description: 'View repositories in an organization',
  handler: async ({ orgSlug, outputKind, repoName }) => {
    await handleViewRepo(orgSlug, String(repoName), outputKind)
  },
  helpExamples: ['test-repo', 'test-repo --json'],
})
