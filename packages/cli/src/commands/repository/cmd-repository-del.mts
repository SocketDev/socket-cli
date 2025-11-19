import { handleDeleteRepo } from './handle-delete-repo.mts'
import { createRepositoryCommand } from './repository-command-factory.mts'

export const CMD_NAME = 'del'

export const cmdRepositoryDel = createRepositoryCommand({
  commandName: CMD_NAME,
  description: 'Delete a repository in an organization',
  handler: async ({ orgSlug, outputKind, repoName }) => {
    await handleDeleteRepo(orgSlug, repoName, outputKind)
  },
  helpExamples: ['test-repo'],
})
