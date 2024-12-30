import { parseArgs } from 'util'
import { CliSubcommand } from '../../utils/meow-with-subcommands'
import simpleGit from 'simple-git'
import { Octokit } from '@octokit/rest'
import { SocketSdk, SocketSdkResultType } from '@socketsecurity/sdk'
import type { components, operations } from '@socketsecurity/sdk/types/api.d.ts'
import micromatch from 'micromatch'
import ndjson from 'ndjson'
import ignore from 'ignore'
const octokit = new Octokit()
const socket = new SocketSdk(getDefaultKey() ?? FREE_API_KEY, {
  baseUrl: getDefaultAPIBaseUrl()
})

// https://github.com/actions/checkout/issues/58#issuecomment-2264361099
const prNumber = parseInt(
  process.env['GITHUB_REF']?.match(/refs\/pull\/(\d+)\/merge/)?.at(1) ?? ''
)

function eventType(): 'main' | 'diff' | 'comment' | 'unsupported' {
  switch (process.env['GITHUB_EVENT_NAME']) {
    case 'push':
      return prNumber ? 'diff' : 'main'

    case 'pull_request':
      // Provided by github.event.action, add this code below to GitHub action
      //  if: github.event_name == 'pull_request'
      //  run: echo "EVENT_ACTION=${{ github.event.action }}" >> $GITHUB_ENV
      const eventAction = process.env['EVENT_ACTION']

      if (!eventAction) {
        throw new Error('Missing event action')
      }

      if (['opened', 'synchronize'].includes(eventAction)) {
        return 'diff'
      } else {
        console.log(`Pull request action: ${eventAction} is not supported`)
        process.exit()
      }

    case 'issue_comment':
      return 'comment'

    default:
      throw new Error(`Unknown event type: ${process.env['GITHUB_EVENT_NAME']}`)
  }
}

export const action: CliSubcommand = {
  description: 'Socket action command',
  async run(args: readonly string[]) {
    const { values } = parseArgs({
      ...args,
      options: {
        socketSecurityApiKey: {
          type: 'string',
          default: process.env['SOCKET_SECURITY_API_KEY']
        },
        githubEventBefore: {
          type: 'string',
          default: ''
        },
        githubEventAfter: {
          type: 'string',
          default: ''
        }
      },
      strict: true,
      allowPositionals: true
    })

    const git = simpleGit()
    const changedFiles = (
      await git.diff(
        process.env['GITHUB_EVENT_NAME'] === 'pull_request'
          ? ['--name-only', 'HEAD^1', 'HEAD']
          : ['--name-only', values.githubEventBefore, values.githubEventAfter]
      )
    ).split('\n')

    console.log({ changedFiles })
    // supportedFiles have 3-level depp globs
    const patterns = Object.values(await socket.getReportSupportedFiles())
      .flatMap((i: Record<string, any>) => Object.values(i))
      .flatMap((i: Record<string, any>) => Object.values(i))
      .flatMap((i: Record<string, any>) => Object.values(i))

    const files = micromatch(changedFiles, patterns)
    console.log({ files })

    if (eventType() === 'comment') {
      console.log('Comment initiated flow')
      const [owner = '', repo = ''] = (
        process.env['GITHUB_REPOSITORY'] ?? ''
      ).split('/')
      const { data: comments } = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber
      })
      type Comments = Awaited<
        ReturnType<typeof octokit.rest.issues.listComments>
      >['data']
      console.log({ comments })
      // Socket only comments
      const socketComments: {
        security?: Comments[0]
        overview?: Comments[0]
        ignore: Comments
      } = {
        ignore: []
      }
      for (const comment of comments) {
        if (comment.body?.includes('socket-security-comment-actions')) {
          socketComments.security = comment
        } else if (comment.body?.includes('socket-overview-comment-actions')) {
          socketComments.overview = comment
        } else if (
          // Based on:
          // To ignore an alert, reply with a comment starting with @SocketSecurity ignore
          // followed by a space separated list of ecosystem/package-name@version specifiers.
          // e.g. @SocketSecurity ignore npm/foo@1.0.0 or ignore all packages with @SocketSecurity ignore-all
          comment.body?.split('\n').at(0)?.includes('SocketSecurity ignore')
        ) {
          socketComments.ignore.push(comment)
        }
      }

      if (eventType() === 'comment') {
        console.log('Comment initiated flow')
        // removeCommentAlerts https://github.com/SocketDev/socket-python-cli/blob/main/socketsecurity/core/github.py#L206
        if (socketComments.security) {
          // Handle ignore reactions https://github.com/SocketDev/socket-python-cli/blob/main/socketsecurity/core/github.py#L215
          for (const ignoreComment of socketComments.ignore) {
            if (
              ignoreComment.body?.includes('SocketSecurity ignore') &&
              !commentReactionExists({
                owner,
                repo,
                commentId: ignoreComment.id
              })
            ) {
              postReaction({ owner, repo, commentId: ignoreComment.id })
            }
          }
          const body = processSecurityComment({
            securityComment: socketComments.security,
            ignoreComments: socketComments.ignore
          })
          // Update comment
          await octokit.issues.updateComment({
            owner,
            repo,
            comment_id: socketComments.security.id,
            body
          })
        }
      } else if (eventType() === 'diff') {
        // https://github.com/SocketDev/socket-python-cli/blob/main/socketsecurity/socketcli.py#L341
        console.log('Push initiated flow')
        createNewDiff({
          org: owner,
          repo,
          files,
          params: {}
        })
      }
    }
  }
}

async function postReaction({
  owner,
  repo,
  commentId
}: {
  owner: string
  repo: string
  commentId: number
}) {
  // Post a reaction to the specified comment
  await octokit.reactions.createForIssueComment({
    owner,
    repo,
    comment_id: commentId,
    content: '+1' // "+1" is the GitHub API representation for a thumbs-up reaction
  })
}

async function commentReactionExists({
  owner,
  repo,
  commentId
}: {
  owner: string
  repo: string
  commentId: number
}): Promise<boolean> {
  // Fetch reactions for the specified comment
  const { data } = await octokit.reactions.listForIssueComment({
    owner,
    repo,
    comment_id: commentId
  })

  // Check if any reaction has the content ":thumbsup:"
  const exists = data.some(reaction => reaction.content === '+1')
  return exists
}

// Parse:
// @SocketSecurity ignore pkg1 pkg2 ...
// @SocketSecurity ignore ignore-all
function parseIgnoreCommand(line: string) {
  const result = { packages: [] as string[], ignoreAll: false }
  const words = line.trim().replace(/\s+/g, ' ').split(' ')
  if (words.at(1) === 'ignore-all') {
    result.ignoreAll = true
    return result
  }
  if (words.at(1) === 'ignore') {
    for (let i = 2; i < words.length; i++) {
      const pkg = words[i] as string
      result.packages.push(pkg)
    }
    return result
  }
  return result
}
type Comments = Awaited<
  ReturnType<typeof octokit.rest.issues.listComments>
>['data']

// Ref: https://github.com/socketdev-demo/javascript-threats/pull/89#issuecomment-2456015512
function processSecurityComment({
  securityComment,
  ignoreComments
}: {
  securityComment: Comments[0]
  ignoreComments: Comments
}): string {
  const result: string[] = []
  let start = false

  let ignoreAll = false
  let ignoredPackages = []
  for (const ignoreComment of ignoreComments) {
    const parsed = parseIgnoreCommand(
      ignoreComment.body?.split('\n').at(0) ?? ''
    )
    if (parsed.ignoreAll) {
      ignoreAll = true
      break
    }
    ignoredPackages.push(parsed.packages)
  }

  // Split the comment body into lines and update them
  // to generate a new comment body
  for (let line of securityComment.body?.split('\n') ?? []) {
    line = line.trim()

    if (line.includes('start-socket-alerts-table')) {
      start = true
      result.push(line)
    } else if (
      start &&
      !line.includes('end-socket-alerts-table') &&
      // is not heading line?
      !(
        line === '|Alert|Package|Introduced by|Manifest File|CI|' ||
        line.includes(':---')
      ) &&
      line !== ''
    ) {
      // Parsing Markdown data colunms
      const [_, title, packageLink, introducedBy, manifest, ci] = line.split(
        '|'
      ) as [string, string, string, string, string, string]

      // Parsing package link [npm/pkg](url)
      let [ecosystem, pkg] = packageLink
        .slice(1, packageLink.indexOf(']'))
        .split('/', 2) as [string, string]
      const [pkgName, pkgVersion] = pkg.split('@')

      // Checking if this package should be ignored
      let ignore = false
      if (ignoreAll) {
        ignore = true
      } else {
        for (const [ignoredPkgName, ignorePkgVersion] of ignoredPackages) {
          if (
            pkgName === ignoredPkgName &&
            (ignorePkgVersion === '*' || pkgVersion === ignorePkgVersion)
          ) {
            ignore = true
            break
          }
        }
      }

      if (ignore) {
        break
      }
      result.push(line)
    } else if (line.includes('end-socket-alerts-table')) {
      start = false
      result.push(line)
    } else {
      result.push(line)
    }
  }

  return result.join('\n')
}

/**
 * 1. Get the head full scan. If it isn't present because this repo doesn't exist yet, return an empty full scan.
 * 2. Create a new full scan for the current run.
 * 3. Compare the head and new full scan.
 * 4. Return a Diff report.
 * @param path - Path of where to look for manifest files for the new full scan.
 * @param params - Query parameters for the full scan endpoint.
 * @param workspace - Path for the workspace.
 * @param noChange - Skip the diff process if true.
 * @return Diff report
 */
async function createNewDiff({
  org,
  repo
}: {
  path: string
  org: string
  repo: string
  files: string[]
  params: operations['getOrgFullScan']['parameters']
  workspace: string
}): Promise<Diff> {
  let headFullScanId: string | null
  let headFullScan: any[]

  try {
    const orgRepoResponse = await socket.getOrgRepo(org, repo)
    if (orgRepoResponse.success) {
      if (!orgRepoResponse.data.head_full_scan_id) {
        headFullScan = []
      } else {
        const label = 'Time to get head full-scan'
        console.time(label)
        const orgFullScanResponse = socket.getOrgFullScan(
          org,
          orgRepoResponse.data.head_full_scan_id,
          undefined
        )
        console.timeEnd(label)
      }
    }
  } catch (error) {
    console.error(error)
    headFullScanId = null
    headFullScan = []
  }

  const label = 'Time to get new full-scan'
  console.time(label)
  const newFullScan = await createFullScan(files, params, workspace)
  newFullScan.packages = Core.createSbomDict(newFullScan.sbom_artifacts)
  const newScanEnd = performance.now()
  console.timeEnd(label)

  const diffReport = Core.compareSboms(newFullScan.sbom_artifacts, headFullScan)
  diffReport.packages = newFullScan.packages

  // Set the diff ID and URLs
  const baseSocket = 'https://socket.dev/dashboard/org'
  diffReport.id = newFullScan.id
  diffReport.report_url = `${baseSocket}/${orgSlug}/sbom/${diffReport.id}`

  if (headFullScanId) {
    diffReport.diff_url = `${baseSocket}/${orgSlug}/diff/${diffReport.id}/${headFullScanId}`
  } else {
    diffReport.diff_url = diffReport.report_url
  }

  return diffReport
}

import { URLSearchParams } from 'url'
import { FREE_API_KEY, getDefaultKey } from '../../utils/sdk'
import { once } from 'events'

async function createFullScan(
  owner: string,
  files: string[],
  params: operations['getOrgFullScanList']['parameters']['query'] = {},
  workspace: string
): Promise<{
  fullScan: components['schemas']['SocketReport']
  sbomArtifacts: components['schemas']['SocketArtifact'][]
}> {
  const sendFiles: Array<{ key: string; payload: [string, Buffer] }> = []
  const createFullStart = performance.now()

  console.debug('Creating new full scan')

  const queryParams = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, `${v}`]))
  )
  const fullScan = await socket.createOrgFullScan(owner, queryParams, files)

  if (fullScan.success) {
    const { id: fullScanId } = fullScan.data
    if (fullScanId) {
      // https://docs.socket.dev/reference/getorgfullscan

      const prevFullScan = await socket.getOrgFullScan(
        owner,
        fullScanId,
        undefined
      )

      if (prevFullScan.success) {
        const { data: readStream }: { data: any } = prevFullScan
        // it's a ndjson stream
        // build sbom_artifacts here
        // https://github.com/SocketDev/socket-python-cli/blob/main/socketsecurity/core/__init__.py#L506
        const sbomArtifacts: any = []

        readStream
          .pipe(ndjson.parse())
          .on('data', function (sbomArtifact: any) {
            sbomArtifacts.push(sbomArtifact)
          })

        await once(readStream, 'end')

        return { fullScan: fullScan.data, sbomArtifacts }
      }
    }
  }

  const createFullEnd = performance.now()
  const totalTime = createFullEnd - createFullStart
  console.debug(
    `New Full Scan created in ${(totalTime / 1000).toFixed(2)} seconds`
  )

  return fullScan
}
