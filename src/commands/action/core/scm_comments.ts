// https://github.com/SocketDev/socket-python-cli/blob/6d4fc56faee68d3a4764f1f80f84710635bdaf05/socketsecurity/core/scm_comments.py
import { logger } from '@socketsecurity/registry/lib/logger'

import { Comment, Issue } from './classes'

export type SocketComments = {
  security: Comment | undefined
  overview: Comment | undefined
  ignore: Comment[]
}

export function checkForSocketComments({
  comments
}: {
  comments: Record<string, Comment>
}): SocketComments {
  const socketComments: {
    security: Comment | undefined
    overview: Comment | undefined
    ignore: Comment[]
  } = {
    security: undefined,
    overview: undefined,
    ignore: []
  }

  for (const commentId in comments) {
    const comment = comments[commentId]!

    if (comment.body.includes('socket-security-comment-actions')) {
      socketComments.security = comment
    } else if (comment.body.includes('socket-overview-comment-actions')) {
      socketComments.overview = comment
    } else if (
      // Based on:
      // To ignore an alert, reply with a comment starting with @SocketSecurity ignore
      // followed by a space separated list of ecosystem/package-name@version specifiers.
      // e.g. @SocketSecurity ignore npm/foo@1.0.0 or ignore all packages with @SocketSecurity ignore-all
      comment.body
        .split('\n')
        .at(0)
        ?.includes('SocketSecurity ignore')
    ) {
      socketComments.ignore.push(comment)
    }
  }

  return socketComments
}

// Parses the ignore command
// @SocketSecurity ignore pkg1 pkg2 ...
// @SocketSecurity ignore ignore-all
export function parseIgnoreCommand(line: string) {
  const result = { packages: <string[]>[], ignoreAll: false }
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

// Ref: https://github.com/socketdev-demo/javascript-threats/pull/89#issuecomment-2456015512
export function processSecurityComment({
  ignore: ignoreComments,
  security: securityComment
}: Pick<SocketComments, 'security' | 'ignore'>): string {
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
  for (let line of securityComment?.body?.split('\n') ?? []) {
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
      const [_, _title, packageLink, _introducedBy, _manifest, _ci] =
        line.split('|') as [string, string, string, string, string, string]

      // Parsing package link [npm/pkg](url)
      let [_ecosystem, pkg] = packageLink
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

export function getIgnoreOptions({ comments }: { comments: SocketComments }) {
  const ignoreCommands: string[] = []
  let ignoreAll = false

  for (const comment of comments.ignore) {
    let firstLine = comment.body_list[0]!
    if (!ignoreAll && firstLine.includes('SocketSecurity ignore')) {
      try {
        firstLine = firstLine.replace(/@/, '')
        let [, command] = firstLine.split('SocketSecurity ')
        command = command!.trim()
        if (command === 'ignore-all') {
          ignoreAll = true
        } else {
          command = command.replace(/ignore/, '').trim()
          const [name, version] = command.split('@')
          const data = `${name}/${version}`
          ignoreCommands.push(data)
        }
      } catch (e: any) {
        logger.error(`Unable to process ignore command for ${comment}`)
        logger.error(e)
      }
    }
  }
  return { ignoreAll, ignoreCommands }
}

export function removeAlerts({
  comments,
  newAlerts
}: {
  comments: SocketComments
  newAlerts: Issue[]
}) {
  const alerts: Issue[] = []

  if (comments.ignore.length === 0) {
    return newAlerts
  }

  const { ignoreAll, ignoreCommands } = getIgnoreOptions({
    comments
  })

  for (const alert of newAlerts) {
    if (ignoreAll) {
      break
    } else {
      const fullName = `${alert.pkg_type}/${alert.pkg_name}`
      const purl = `${fullName}/${alert.pkg_version}`
      const purlStar = `${fullName}/*`
      if (ignoreCommands.includes(purl) || ignoreCommands.includes(purlStar)) {
        logger.log(`Alerts for ${alert.pkg_name}@${alert.pkg_version} ignored`)
      } else {
        logger.log(
          `Adding alert ${alert.type} for ${alert.pkg_name}@${alert.pkg_version}`
        )
        alerts.push(alert)
      }
    }
  }

  return alerts
}
