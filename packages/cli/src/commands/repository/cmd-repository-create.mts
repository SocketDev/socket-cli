import { handleCreateRepo } from './handle-create-repo.mts'
import { createRepositoryCommand } from './repository-command-factory.mts'
import { stringFlagValue } from '../../flags.mts'

export const CMD_NAME = 'create'

export const cmdRepositoryCreate = createRepositoryCommand({
  commandName: CMD_NAME,
  description: 'Create a repository in an organization',
  extraFlags: {
    defaultBranch: {
      default: 'main',
      description: 'Repository default branch. Defaults to "main"',
      type: 'string',
    },
    homepage: {
      default: '',
      description: 'Repository url',
      type: 'string',
    },
    repoDescription: {
      default: '',
      description: 'Repository description',
      type: 'string',
    },
    visibility: {
      default: 'private',
      description: 'Repository visibility (Default Private)',
      type: 'string',
    },
  },
  handler: async ({ flags, orgSlug, outputKind, repoName }) => {
    const visibility = stringFlagValue(flags['visibility'], 'private')
    await handleCreateRepo(
      {
        defaultBranch: stringFlagValue(flags['defaultBranch']),
        description: stringFlagValue(flags['repoDescription']),
        homepage: stringFlagValue(flags['homepage']),
        orgSlug,
        repoName: repoName,
        visibility: visibility === 'public' ? 'public' : 'private',
      },
      outputKind,
    )
  },
  helpDescription:
    'The REPO name should be a "slug". Follows the same naming convention as GitHub.',
  helpExamples: [
    'test-repo',
    'our-repo --homepage=socket.dev --default-branch=trunk',
  ],
})
