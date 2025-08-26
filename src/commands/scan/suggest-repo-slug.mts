import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { SetupSdkOptions } from '../../utils/sdk.mts'

export type SuggestRepoSlugOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

export async function suggestRepoSlug(
  orgSlug: string,
  options?: SuggestRepoSlugOptions | undefined,
): Promise<{
  slug: string
  defaultBranch: string
} | void> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as SuggestRepoSlugOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return
  }
  const sockSdk = sockSdkCResult.data

  // If there's a repo with the same name as cwd then
  // default the selection to that name.
  const result = await handleApiCall(
    sockSdk.getOrgRepoList(orgSlug, {
      orgSlug,
      sort: 'name',
      direction: 'asc',
      // There's no guarantee that the cwd is part of this page. If it's not
      // then do an additional request and specific search for it instead.
      // This way we can offer the tip of "do you want to create [cwd]?".
      perPage: '10',
      page: '0',
    }),
    { desc: 'list of repositories' },
  )

  // Ignore a failed request here. It was not the primary goal of
  // running this command and reporting it only leads to end-user confusion.
  if (result.ok) {
    const currentDirName = dirNameToSlug(path.basename(process.cwd()))

    let cwdIsKnown =
      !!currentDirName &&
      result.data.results.some(obj => obj.slug === currentDirName)
    if (!cwdIsKnown && currentDirName) {
      // Do an explicit request so we can assert that the cwd exists or not
      const result = await handleApiCall(
        sockSdk.getOrgRepo(orgSlug, currentDirName),
        { desc: 'check if current cwd is a known repo' },
      )
      if (result.ok) {
        cwdIsKnown = true
      }
    }

    const proceed = await select<string>({
      message:
        'Missing repo name; do you want to use any of these known repo names for this scan?',
      choices:
        // Put the CWD suggestion at the top, whether it exists or not
        (currentDirName
          ? [
              {
                name: `Yes, current dir [${cwdIsKnown ? currentDirName : `create repo for ${currentDirName}`}]`,
                value: currentDirName,
                description: cwdIsKnown
                  ? 'Register a new repo name under the given org and use it'
                  : 'Use current dir as repo',
              },
            ]
          : []
        ).concat(
          result.data.results
            .filter(({ slug }) => !!slug && slug !== currentDirName)
            .map(({ slug }) => ({
              name: 'Yes [' + slug + ']',
              value: slug || '', // Filtered above but TS is like nah.
              description: `Use "${slug}" as the repo name`,
            })),
          {
            name: 'No',
            value: '',
            description: 'Do not use any of these repos (will end in a no-op)',
          },
        ),
    })

    if (proceed) {
      const repoName = proceed
      let repoDefaultBranch = ''
      // Store the default branch to help with the branch name question next
      for (const obj of result.data.results) {
        if (obj.slug === proceed && obj.default_branch) {
          repoDefaultBranch = obj.default_branch
          break
        }
      }
      return { slug: repoName, defaultBranch: repoDefaultBranch }
    }
  } else {
    logger.fail('Failed to lookup repo list from API, unable to suggest.')
  }
}

function dirNameToSlug(name: string): string {
  // Uses slug specs asserted by our servers
  // Note: this can lead to collisions; eg. slug for `x--y` and `x---y` is `x-y`
  return name
    .toLowerCase()
    .replace(/[^[a-zA-Z0-9_.-]/g, '_')
    .replace(/--+/g, '-')
    .replace(/__+/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/[._-]+$/, '')
}
