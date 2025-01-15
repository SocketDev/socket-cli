import { parseArgs } from 'util'
import { CliSubcommand } from '../../utils/meow-with-subcommands'
import simpleGit from 'simple-git'
import { Octokit } from '@octokit/rest'
import { SocketSdk, SocketSdkResultType } from '@socketsecurity/sdk'
import type { components, operations } from '@socketsecurity/sdk/types/api.d.ts'
import micromatch from 'micromatch'
import ndjson from 'ndjson'
import { PackageURL } from '@socketsecurity/packageurl-js'
import { URLSearchParams } from 'url'
import { FREE_API_KEY, getDefaultKey } from '../../utils/sdk'
import { on, once } from 'events'
import { deepEqual } from 'assert'

const octokit = new Octokit()
const socket = new SocketSdk(getDefaultKey() ?? FREE_API_KEY)

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
          owner: owner,
          repo,
          files,
          params: {
            repo
            //             repo=repo,
            // branch=branch,
            // commit_message=commit_message,
            // commit_hash=commit_sha,
            // pull_request=pr_number,
            // committers=committer,
            // make_default_branch=default_branch,
            // set_as_pending_head=set_as_pending_head
          }
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
  owner,
  repo,
  files,
  params
}: {
  owner: string
  repo: string
  files: string[]
  params: operations['CreateOrgFullScan']['parameters']['query']
}): Promise<{
  newPackages: string[]
  // TODO: replace any
  newCapabilites: Record<string, any>
  removedPackages: string[]
  newAlerts: string[]
  id: string
  sbom: string
  packages: Packages
  reportUrl: string
  diffUrl: string
}> {
  let headFullScanId: string | null = null
  let headFullScan: any[] = []

  try {
    const orgRepoResponse = await socket.getOrgRepo(owner, repo)
    if (orgRepoResponse.success) {
      if (!orgRepoResponse.data.head_full_scan_id) {
        headFullScan = []
      } else {
        const label = 'Time to get head full-scan'
        console.time(label)
        const orgFullScanResponse = socket.getOrgFullScan(
          owner,
          orgRepoResponse.data.head_full_scan_id,
          undefined
        )
        console.timeEnd(label)
      }
    }
  } catch (error) {
    console.error(error)
  }

  const label = 'Time to get new full-scan'
  console.time(label)
  const newFullScan = await createFullScan({ owner, files, params })
  if (!newFullScan) {
    throw new Error('Failed to create a new full scan')
  }
  const newFullScanPackages = createSbomDict(newFullScan.sbomArtifacts)
  console.timeEnd(label)

  const securityPolicy = (await getSecurityPolicy(owner)) ?? {}
  const diffReport = await compareSBOMs({
    newScan: newFullScan.sbomArtifacts,
    headScan: headFullScan,
    securityPolicy
  })

  // Set the diff ID and URLs
  const baseSocket = 'https://socket.dev/dashboard/org'
  const id = newFullScan.fullScan.id
  const reportUrl = `${baseSocket}/${owner}/sbom/${id}`

  let diffUrl
  if (headFullScanId) {
    diffUrl = `${baseSocket}/${owner}/diff/${diffReport.id}/${headFullScanId}`
  } else {
    diffUrl = reportUrl
  }

  // return diffReport
  return {
    packages: newFullScanPackages
  }
}

// https://github.com/SocketDev/socket-python-cli/blob/main/socketsecurity/core/__init__.py#L467
async function compareSBOMs({
  newScan,
  headScan,
  securityPolicy
}: {
  newScan: components['schemas']['SocketArtifact'][]
  headScan: components['schemas']['SocketArtifact'][]
  securityPolicy: NonNullable<Awaited<ReturnType<typeof getSecurityPolicy>>>
}) {
  const diff: {
    newPackages: Awaited<ReturnType<typeof createExtendedPurl>>[]
    removedPackages: Awaited<ReturnType<typeof createExtendedPurl>>[]
  } = {
    newPackages: [],
    removedPackages: []
  }
  const newPackages = createSbomDict(newScan)
  const headPackages = createSbomDict(headScan)

  let newScanAlerts = {}
  let headScanAlerts = {}

  const consolidated = new Set()

  for (const [packageId, pkg] of Object.entries(newPackages)) {
    // TODO: may be unnecessary
    const purl = createExtendedPurl(packageId, newPackages)
    const basePurl = new PackageURL(
      pkg.type,
      pkg.name,
      pkg.namespace,
      pkg.version
    )

    // TODO: check that purl is not in consolidated
    if (!headPackages[packageId] && pkg.direct && !consolidated.has(basePurl)) {
      diff.newPackages.push(purl)
      consolidated.add(packageId)
    }
    newScanAlerts = await createIssueAlerts({
      pkg,
      alerts: newScanAlerts,
      packages: newPackages,
      securityPolicy
    })
  }

  for (const [packageId, pkg] of Object.entries(headPackages)) {
    const purl = createExtendedPurl(packageId, headPackages)
    if (!newPackages[packageId] && pkg.direct) {
      diff.removedPackages.push(purl)
    }
    headScanAlerts = await createIssueAlerts({
      pkg,
      alerts: headScanAlerts,
      packages: headPackages,
      securityPolicy
    })
  }

  return {
    newAlerts: compareIssueAlerts({
      newScanAlerts,
      headScanAlerts
    }),
    newCapabilites: compareCapabilities({ newPackages, headPackages })
  }
}

function compareIssueAlerts({
  newScanAlerts,
  headScanAlerts
}: {
  newScanAlerts: Record<string, IssueAlert[]>
  headScanAlerts: Record<string, IssueAlert[]>
}): IssueAlert[] {
  const alerts: IssueAlert[] = []
  /**
   * Compare the issue alerts from the new full scan and the head full scans. Return a list of new alerts that
   * are in the new full scan and not in the head full scan
   */
  const consolidatedAlerts: string[] = []

  for (const alertKey in newScanAlerts) {
    if (!(alertKey in headScanAlerts)) {
      const newAlerts = newScanAlerts[alertKey] ?? []
      for (const alert of newAlerts) {
        const alertStr = `${alert.purl},,${alert.type}`
        if (
          (alert.error || alert.warn) &&
          !consolidatedAlerts.includes(alertStr)
        ) {
          alerts.push(alert)
          consolidatedAlerts.push(alertStr)
        }
      }
    } else {
      const newAlerts = newScanAlerts[alertKey] ?? []
      const headAlerts = headScanAlerts[alertKey] ?? []
      for (const alert of newAlerts) {
        const alertStr = `${alert.purl},,${alert.type}`
        if (
          !headAlerts.some(
            headAlert =>
              headAlert.purl === alert.purl && headAlert.type === alert.type
          ) &&
          !consolidatedAlerts.includes(alertStr)
        ) {
          if (alert.error || alert.warn) {
            alerts.push(alert)
            consolidatedAlerts.push(alertStr)
          }
        }
      }
    }
  }

  return alerts
}
type Capabilities = Record<string, string[]>
function compareCapabilities({
  newPackages,
  headPackages
}: {
  newPackages: Record<string, Package>
  headPackages: Record<string, Package>
}): Capabilities {
  let capabilities: Capabilities = {}

  for (const packageId in newPackages) {
    const pkg = newPackages[packageId]
    if (!pkg) continue

    if (packageId in headPackages) {
      const headPackage = headPackages[packageId]
      if (!headPackage) continue

      for (const alert of pkg?.alerts ?? []) {
        if (
          !headPackage?.alerts?.some(headAlert => deepEqual(headAlert, alert))
        ) {
          capabilities = checkAlertCapabilities({
            pkg,
            capabilities,
            packageId,
            headPackage
          })
        }
      }
    } else {
      capabilities = checkAlertCapabilities({ pkg, capabilities, packageId })
    }
  }

  return capabilities
}

function checkAlertCapabilities({
  pkg,
  capabilities = {},
  packageId,
  headPackage
}: {
  pkg: Package
  capabilities: Capabilities
  packageId: string
  headPackage?: Package
}): Capabilities {
  const alertTypes = {
    envVars: 'Environment',
    networkAccess: 'Network',
    filesystemAccess: 'File System',
    shellAccess: 'Shell'
  }

  for (const alert of pkg.alerts ?? []) {
    let newAlert = true
    if (headPackage?.alerts?.find(headAlert => deepEqual(headAlert, alert))) {
      newAlert = false
    }

    // Process the alert if it's new and its type is in alertTypes
    if (alert.type in alertTypes && newAlert) {
      // @ts-ignore
      const value = alertTypes[alert.type]

      if (!(packageId in capabilities)) {
        capabilities[packageId] = [value]
      } else if (!capabilities[packageId]?.includes(value)) {
        capabilities[packageId]?.push(value)
      }
    }
  }

  return capabilities
}

function createExtendedPurl(
  packageId: string,
  packages: Packages
): {
  id: string
  name: string | undefined
  version: string | undefined
  ecosystem: string
  direct: boolean | undefined
  introducedBy: [string, string][]
  author: string[]
  size: number | undefined
  transitives: number
  url: string
  purl: string
} {
  const pkg = packages[packageId]
  if (!pkg) throw new Error()
  const introducedBy = getSourceData(pkg, packages)
  return {
    id: packageId,
    name: pkg.name,
    version: pkg.version,
    ecosystem: pkg.type,
    direct: pkg.direct,
    introducedBy,
    author: pkg.author ?? [],
    size: pkg.size,
    transitives: pkg.transitives,
    url: pkg.url,
    purl: pkg.purl
  }
}

async function getSecurityPolicy(orgId: string) {
  const response = await socket.postSettings([{ organization: orgId }])
  if (response.success) {
    const {
      defaults: { issueRules },
      entries
    } = response.data
    type DefaultIssueRules = (typeof response.data)['defaults']['issueRules']
    type EntryIssueRule =
      (typeof response.data)['entries'][number]['settings'][string]['issueRules']

    let orgRules: DefaultIssueRules | EntryIssueRule = {}
    for (const orgSet of entries) {
      const {
        settings: { organization }
      } = orgSet
      if (organization) {
        orgRules = organization.issueRules
      }
    }
    for (const issueRule in issueRules) {
      if (!(issueRule in orgRules)) {
        const action = issueRules['default']?.action
        if (action) {
          orgRules['default'] = { action }
        }
      }
    }
    return orgRules
  }
}
type IssueAlert = {
  pkgType: Package['type']
  pkgName: Package['name']
  pkgVersion: Package['version']
  pkgId: Package['id']
  type: NonNullable<Package['alerts']>[number]['type']
  severity: NonNullable<Package['alerts']>[number]['severity']
  key: NonNullable<Package['alerts']>[number]['key']
  props: NonNullable<Package['alerts']>[number]['props']
  description: string
  title: string
  suggestion: string
  nextStepTitle: string
  introducedBy: [string, string][]
  purl: string
  url: string
  // actions
  error: boolean
  ignore: boolean
  warn: boolean
  defer: boolean
  monitor: boolean
}

/**
 * Create the Issue Alerts from the package and base alert data.
 * @param pkg - Current package being evaluated
 * @param alerts - All found Issue Alerts across all packages
 * @param packages - All packages needed to determine top-level package information
 * @returns Updated alerts
 */
async function createIssueAlerts({
  pkg,
  alerts,
  packages,
  securityPolicy
}: {
  pkg: Package
  alerts: Record<string, IssueAlert[]>
  packages: Packages
  securityPolicy: NonNullable<Awaited<ReturnType<typeof getSecurityPolicy>>>
}): Promise<Record<string, IssueAlert[]>> {
  for (const alert of pkg?.alerts ?? []) {
    // Extract alert properties
    // TODO: retrieve or find way to get known issues
    // const issue = allIssues[alert.type] || null
    //
    // const description = issue?.description || ''
    // const title = issue?.title || ''
    // const suggestion = issue?.suggestion || ''
    // const nextStepTitle = issue?.nextStepTitle || ''

    const description = ''
    const title = ''
    const suggestion = ''
    const nextStepTitle = ''

    // Get source data
    const introducedBy = getSourceData(pkg, packages)

    // Create Issue
    const issueAlert: IssueAlert = {
      pkgType: pkg.type,
      pkgName: pkg.name,
      pkgVersion: pkg.version,
      pkgId: pkg.id,
      type: alert.type,
      severity: alert.severity,
      key: alert.key,
      props: alert.props,
      description,
      title,
      suggestion,
      nextStepTitle,
      introducedBy,
      purl: pkg.purl,
      url: pkg.url,
      error: false,
      ignore: false,
      warn: false,
      defer: false,
      monitor: false
    }

    // Apply security policy actions
    if (alert.type in securityPolicy) {
      const action = securityPolicy[alert.type]?.action
      if (action) {
        issueAlert[action] = true // Dynamically set property based on policy action
      }
    }

    // Add to alerts if type is not 'licenseSpdxDisj'
    if (issueAlert.type !== 'licenseSpdxDisj') {
      if (!alerts[issueAlert.key]) {
        alerts[issueAlert.key] = [issueAlert]
      } else {
        alerts[issueAlert.key]?.push(issueAlert)
      }
    }
  }

  return alerts
}

/**
 * Creates the properties for source data of the source manifest file(s) and top-level packages.
 * @param pkg - Current package being evaluated
 * @param packages - All packages, used to determine top-level package information for transitive packages
 * @returns Array of tuples with source type and manifest files
 */
function getSourceData(
  pkg: Packages[keyof Packages],
  packages: Packages
): [string, string][] {
  const introducedBy: [string, string][] = []

  if (pkg.direct) {
    // Handle direct packages
    let manifests = (pkg.manifestFiles ?? [])
      .map(manifest => manifest.file)
      .join(';')

    introducedBy.push(['direct', manifests])
  } else {
    // Handle transitive packages
    for (const topId of pkg.topLevelAncestors ?? []) {
      const topPackage = packages[topId] // Retrieve the top-level package
      if (!topPackage) continue

      // Construct manifest file string
      let manifests = (topPackage?.manifestFiles ?? [])
        .map(manifest => manifest.file)
        .join(';')

      const topPurl = `${topPackage.type}/${topPackage.name}@${topPackage.version}`
      introducedBy.push([topPurl, manifests])
    }
  }

  return introducedBy
}

// OK
async function createFullScan({
  owner,
  files,
  params
}: {
  owner: string
  files: string[]
  params: operations['CreateOrgFullScan']['parameters']['query']
}): Promise<
  | {
      fullScan: operations['CreateOrgFullScan']['responses']['201']['content']['application/json']
      sbomArtifacts: components['schemas']['SocketArtifact'][]
    }
  | undefined
> {
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
}

type Package = components['schemas']['SocketArtifact'] & {
  purl: string
  url: string
  transitives: number
}
type Packages = Record<string, Package>

// OK
function createSbomDict(
  sbomArtifacts: components['schemas']['SocketArtifact'][]
): Packages {
  const packages: Packages = {}
  const topLevelCount: Record<string, number> = {}

  for (const sbomArtifact of sbomArtifacts) {
    const packageItem = sbomArtifact

    if (packages[packageItem.id]) {
      console.log('Duplicate package?')
    } else {
      // TODO: get license details
      // const packageWithDetails = getLicenseDetails(packageItem)
      packages[sbomArtifact.id] = { ...sbomArtifact, transitives: 0 }

      for (const topId of sbomArtifact.topLevelAncestors ?? []) {
        if (!topLevelCount[topId]) {
          topLevelCount[topId] = 1
        } else {
          topLevelCount[topId] += 1
        }
      }
    }
  }

  if (Object.keys(topLevelCount).length > 0) {
    for (const packageId in topLevelCount) {
      const pkg = packages[packageId]
      if (pkg) {
        pkg.transitives = topLevelCount[packageId] ?? 0
      }
    }
  }

  return packages
}