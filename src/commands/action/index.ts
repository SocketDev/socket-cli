// https://github.com/SocketDev/socket-python-cli/blob/6d4fc56faee68d3a4764f1f80f84710635bdaf05/socketsecurity/socketcli.py
import { parseArgs } from 'util'

import micromatch from 'micromatch'
import { simpleGit } from 'simple-git'

import { SocketSdk } from '@socketsecurity/sdk'

import { Core } from './core'
import { GitHub } from './core/github'
import * as Messages from './core/messages'
import * as SCMComments from './core/scm_comments'
import { CliSubcommand } from '../../utils/meow-with-subcommands'
import { getDefaultToken } from '../../utils/sdk'

const socket = new SocketSdk(getDefaultToken()!)

export const action: CliSubcommand = {
  description: 'Socket action command',
  hidden: true,
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
    // supportedFiles have 3-level deep globs
    const patterns = Object.values(await socket.getReportSupportedFiles())
      .flatMap((i: Record<string, any>) => Object.values(i))
      .flatMap((i: Record<string, any>) => Object.values(i))
      .flatMap((i: Record<string, any>) => Object.values(i))

    const files = micromatch(changedFiles, patterns)

    const scm = new GitHub()

    if (scm.checkEventType() === 'comment') {
      console.log('Comment initiated flow')
      const comments = await scm.getCommentsForPR()
      await scm.removeCommentAlerts({ comments })
    } else if (scm.checkEventType() === 'diff') {
      console.log('Push initiated flow')
      const core = new Core({ owner: scm.owner, repo: scm.repo, files, socket })
      const diff = await core.createNewDiff({})
      const comments = await scm.getCommentsForPR()
      diff.newAlerts = SCMComments.removeAlerts({
        comments,
        newAlerts: diff.newAlerts
      })
      const overviewComment = Messages.dependencyOverviewTemplate(diff)
      const securityComment = Messages.securityCommentTemplate(diff)
      let newSecurityComment = true
      let newOverviewComment = true
      let updateOldSecurityComment = comments.security !== undefined
      let updateOldOverviewComment = comments.overview !== undefined
      if (diff.newAlerts.length === 0) {
        if (!updateOldSecurityComment) {
          newSecurityComment = false
          console.log('No new alerts or security issue comment disabled')
        } else {
          console.log('Updated security comment with no new alerts')
        }
      }
      if (diff.newPackages.length === 0 && diff.removedPackages.length === 0) {
        if (!updateOldOverviewComment) {
          newOverviewComment = false
          console.log(
            'No new/removed packages or Dependency Overview comment disabled'
          )
        } else {
          console.log('Updated overview comment with no dependencies')
        }
      }
      await scm.addSocketComments({
        securityComment,
        overviewComment,
        comments,
        newSecurityComment,
        newOverviewComment
      })
    }
  }
}
