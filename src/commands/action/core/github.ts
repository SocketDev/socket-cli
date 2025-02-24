// https://github.com/SocketDev/socket-python-cli/blob/6d4fc56faee68d3a4764f1f80f84710635bdaf05/socketsecurity/core/github.py
/* eslint-disable no-await-in-loop */
import { Octokit } from '@octokit/rest'

import { Comment } from './classes'
import * as SCMComments from './scm_comments'

export class GitHub {
  octokit: Octokit = new Octokit()
  owner: string
  repo: string
  prNumber: number

  constructor() {
    const [owner = '', repo = ''] = (
      process.env['GITHUB_REPOSITORY'] ?? ''
    ).split('/')
    // https://github.com/actions/checkout/issues/58#issuecomment-2264361099
    const prNumber = parseInt(
      process.env['GITHUB_REF']?.match(/refs\/pull\/(\d+)\/merge/)?.at(1) ?? ''
    )
    this.owner = owner
    this.repo = repo
    this.prNumber = prNumber
  }

  checkEventType(): 'main' | 'diff' | 'comment' | 'unsupported' {
    switch (process.env['GITHUB_EVENT_NAME']) {
      case 'push':
        return this.prNumber ? 'diff' : 'main'
      case 'pull_request':
        // This env variable needs to be set in the GitHub action.
        // Add this code below to GitHub action:
        // - steps:
        //   - name: Get PR State
        //     if: github.event_name == 'pull_request'
        //     run: echo "EVENT_ACTION=${{ github.event.action }}" >> $GITHUB_ENV
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
        throw new Error(
          `Unknown event type: ${process.env['GITHUB_EVENT_NAME']}`
        )
    }
  }

  async getCommentsForPR(): Promise<SCMComments.SocketComments> {
    const { data: githubComments } =
      await this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: this.prNumber
      })
    const comments: Record<string, Comment> = {}
    for (const githubComment of githubComments) {
      comments[githubComment.id] = new Comment({
        id: githubComment.id,
        body: githubComment.body ?? '',
        body_list: (githubComment.body ?? '').split('\n')
      })
    }
    return SCMComments.checkForSocketComments({ comments })
  }

  async commentReactionExists({
    commentId
  }: {
    commentId: number
  }): Promise<boolean> {
    const { data } = await this.octokit.reactions.listForIssueComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId
    })
    return data.some(reaction => reaction.content === '+1')
  }

  async postReaction({ commentId }: { commentId: number }) {
    await this.octokit.reactions.createForIssueComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      content: '+1'
    })
  }

  async handleIgnoreReactons({
    comments
  }: {
    comments: SCMComments.SocketComments
  }) {
    for (const ignoreComment of comments.ignore) {
      if (
        ignoreComment.body?.includes('SocketSecurity ignore') &&
        !(await this.commentReactionExists({
          commentId: ignoreComment.id
        }))
      ) {
        await this.postReaction({ commentId: ignoreComment.id })
      }
    }
  }

  async updateComment({ body, id }: { id: number; body: string }) {
    await this.octokit.issues.updateComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: id,
      body
    })
  }

  async removeCommentAlerts({
    comments
  }: {
    comments: SCMComments.SocketComments
  }) {
    const securityAlert = comments.security
    if (securityAlert !== undefined) {
      const newBody = SCMComments.processSecurityComment({
        security: comments.security,
        ignore: comments.ignore
      })
      await this.handleIgnoreReactons({ comments })
      await this.updateComment({ id: securityAlert.id, body: newBody })
    }
  }

  async postComment({ body }: { body: string }) {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.prNumber,
      body
    })
  }

  async addSocketComments({
    comments,
    newOverviewComment,
    newSecurityComment,
    overviewComment,
    securityComment
  }: {
    securityComment: string
    overviewComment: string
    comments: SCMComments.SocketComments
    newSecurityComment: boolean
    newOverviewComment: boolean
  }): Promise<void> {
    const {
      overview: existingOverviewComment,
      security: existingSecurityComment
    } = comments
    if (newOverviewComment) {
      console.log('New Dependency Overview comment')
      if (existingOverviewComment !== undefined) {
        console.log('Previous version of Dependency Overview, updating')
        await this.updateComment({
          body: overviewComment,
          id: existingOverviewComment.id
        })
      } else {
        console.log('No previous version of Dependency Overview, posting')
        await this.postComment({ body: overviewComment })
      }
    }
    if (newSecurityComment) {
      console.log('New Security Issue Comment')
      if (existingSecurityComment !== undefined) {
        console.log('Previous version of Security Issue comment, updating')
        await this.updateComment({
          body: securityComment,
          id: existingSecurityComment.id
        })
      } else {
        console.log('No Previous version of Security Issue comment, posting')
        await this.postComment({ body: securityComment })
      }
    }
  }
}
