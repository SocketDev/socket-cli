import { handleUpdateRepo } from './handle-update-repo.mts'
import { createRepositoryCommand } from './repository-command-factory.mts'

export const CMD_NAME = 'update'

export const cmdRepositoryUpdate = createRepositoryCommand({
  commandName: CMD_NAME,
  description: 'Update a repository in an organization',
  extraFlags: {
    defaultBranch: {
      default: 'main',
      description: 'Repository default branch',
      shortFlag: 'b',
      type: 'string',
    },
    homepage: {
      default: '',
      description: 'Repository url',
      shortFlag: 'h',
      type: 'string',
    },
    repoDescription: {
      default: '',
      description: 'Repository description',
      shortFlag: 'd',
      type: 'string',
    },
    visibility: {
      default: 'private',
      description: 'Repository visibility (Default Private)',
      shortFlag: 'v',
      type: 'string',
    },
  },
  handler: async ({ flags, orgSlug, outputKind, repoName }) => {
    await handleUpdateRepo(
      {
        defaultBranch: String(flags['defaultBranch'] || ''),
        description: String(flags['repoDescription'] || ''),
        homepage: String(flags['homepage'] || ''),
        orgSlug,
        repoName: String(repoName),
        visibility: String(flags['visibility'] || 'private'),
      },
      outputKind,
    )
  },
  helpExamples: ['test-repo', 'test-repo --homepage https://example.com'],
})
