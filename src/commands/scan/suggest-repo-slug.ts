import path from 'node:path'
import process from 'node:process'

import { select } from '@socketsecurity/registry/lib/prompts'
import { SocketSdk } from '@socketsecurity/sdk'

import { handleApiCall } from '../../utils/api'

export async function suggestRepoSlug(
  socketSdk: SocketSdk,
  orgSlug: string
): Promise<{
  slug: string
  defaultBranch: string
} | void> {
  // Same as above, but if there's a repo with the same name as cwd then
  // default the selection to that name.
  const result = await handleApiCall(
    socketSdk.getOrgRepoList(orgSlug, {
      orgSlug,
      sort: 'name',
      direction: 'asc',
      // There's no guarantee that the cwd is part of this page. If it's not
      // then do an additional request and specific search for it instead.
      // This way we can offer the tip of "do you want to create [cwd]?".
      perPage: '10',
      page: '0'
    }),
    'looking up known repos'
  )
  // Ignore a failed request here. It was not the primary goal of
  // running this command and reporting it only leads to end-user confusion.
  if (result.success) {
    const currentDirName = dirNameToSlug(path.basename(process.cwd()))

    let cwdIsKnown =
      !!currentDirName &&
      result.data.results.some(obj => obj.slug === currentDirName)
    if (!cwdIsKnown && currentDirName) {
      // Do an explicit request so we can assert that the cwd exists or not
      const result = await handleApiCall(
        socketSdk.getOrgRepo(orgSlug, currentDirName),
        'checking if current cwd is a known repo'
      )
      if (result.success) {
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
                  : 'Use current dir as repo'
              }
            ]
          : []
        ).concat(
          result.data.results
            .filter(({ slug }) => !!slug && slug !== currentDirName)
            .map(({ slug }) => ({
              name: 'Yes [' + slug + ']',
              value: slug || '', // Filtered above but TS is like nah.
              description: `Use "${slug}" as the repo name`
            })),
          {
            name: 'No',
            value: '',
            description: 'Do not use any of these repos (will end in a no-op)'
          }
        )
    })

    if (proceed) {
      const repoName = proceed
      let repoDefaultBranch = ''
      // Store the default branch to help with the branch name question next
      result.data.results.some(obj => {
        if (obj.slug === proceed && obj.default_branch) {
          repoDefaultBranch = obj.default_branch
          return
        }
      })
      return { slug: repoName, defaultBranch: repoDefaultBranch }
    }
  } else {
    // TODO: in verbose mode, report this error to stderr
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
