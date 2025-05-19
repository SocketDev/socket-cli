import { select } from '@socketsecurity/registry/lib/prompts'
import { spawnSync } from '@socketsecurity/registry/lib/spawn'

export async function suggestBranchSlug(
  repoDefaultBranch: string | undefined,
): Promise<string | void> {
  const spawnResult = spawnSync('git', ['branch', '--show-current'])
  const currentBranch = spawnResult.stdout.toString('utf8').trim()
  if (currentBranch && spawnResult.status === 0) {
    const proceed = await select<string>({
      message: 'Use the current git branch as target branch name?',
      choices: [
        {
          name: `Yes [${currentBranch}]`,
          value: currentBranch,
          description: 'Use the current git branch for branch name',
        },
        ...(repoDefaultBranch && repoDefaultBranch !== currentBranch
          ? [
              {
                name: `No, use the default branch [${repoDefaultBranch}]`,
                value: repoDefaultBranch,
                description:
                  'Use the default branch for target repo as the target branch name',
              },
            ]
          : []),
        {
          name: 'No',
          value: '',
          description:
            'Do not use the current git branch as name (will end in a no-op)',
        },
      ].filter(Boolean),
    })
    if (proceed) {
      return proceed
    }
  }
}
