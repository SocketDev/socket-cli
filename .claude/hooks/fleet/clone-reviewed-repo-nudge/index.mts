#!/usr/bin/env node
// Claude Code PreToolUse hook — clone-reviewed-repo-nudge.
//
// When an agent reviews or references an EXTERNAL GitHub repo (one that is
// not a SocketDev fleet member), it should clone the repo locally so it can
// `grep` / read / index the tree — rather than reading it only through the
// GitHub web/API a file at a time. The fleet standardizes both WHERE the
// clone lands and HOW small it is:
//
//   Where: ~/.socket/_wheelhouse/repo-clones/<org>-<repo>/  (lowercased +
//          dash-cased; resolve via getSocketRepoClonesDir()). NEVER
//          ~/projects/* — the fleet's sibling-walk tooling treats those as
//          member checkouts.
//   How:   git clone --depth=1 --single-branch --filter=blob:none <url> <dest>
//          (shallow + single-branch + blobless partial = smallest practical
//          footprint and fastest download; blobs fetched lazily on access).
//
// Two nudge arms, both stderr-only (this is a -nudge: it never blocks):
//
//   (1) Reviewing an external repo through `gh` (`gh repo view <owner/repo>`,
//       `gh pr … --repo <owner/repo>`) where <owner> is not SocketDev →
//       nudge to clone it to the standard repo-clones dir first.
//
//   (2) A `git clone` of an external GitHub repo that omits one or more of the
//       smallest-practical flags → nudge to add the missing flags (and to
//       target the repo-clones dir).
//
// The pure detection logic lives in ./detect.mts (unit-tested directly);
// command segments + args come from commandsFor()/findInvocation() (shell-quote
// tokenized), never a raw regex over the whole command line.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withBashGuard } from '../_shared/payload.mts'
import { commandsFor, findInvocation } from '../_shared/shell-command.mts'
import { externalGhRepo, missingCloneFlags, repoClonesName } from './detect.mts'

const logger = getDefaultLogger()

function nudgeMissingFlags(
  owner: string,
  repo: string,
  missing: readonly string[],
): void {
  const dest = `~/.socket/_wheelhouse/repo-clones/${repoClonesName(owner, repo)}/`
  logger.error(
    [
      `[clone-reviewed-repo-nudge] git clone of external repo ${owner}/${repo} omits the smallest-practical flags: ${missing.join(', ')}.`,
      '',
      '  Clone external review repos the smallest practical way (shallow +',
      '  single-branch + blobless partial), into the shared repo-clones dir:',
      '',
      '    git clone --depth=1 --single-branch --filter=blob:none \\',
      `      <url> ${dest}`,
      '',
      '  --filter=blob:none fetches file blobs lazily on first access, so the',
      '  initial download is tree-metadata only. Resolve the dir programmatically',
      '  with getSocketRepoClonesDir() from @socketsecurity/lib/paths/socket.',
      '',
    ].join('\n'),
  )
}

function nudgeCloneForReview(owner: string, repo: string): void {
  const dest = `~/.socket/_wheelhouse/repo-clones/${repoClonesName(owner, repo)}/`
  logger.error(
    [
      `[clone-reviewed-repo-nudge] Reviewing external repo ${owner}/${repo} through gh.`,
      '',
      '  To grep / read / index it efficiently, clone it locally (the smallest',
      '  practical way) into the shared repo-clones dir, then work from there:',
      '',
      '    git clone --depth=1 --single-branch --filter=blob:none \\',
      `      https://github.com/${owner}/${repo} ${dest}`,
      '',
      '  NEVER clone into ~/projects/* — that path is for fleet-member',
      '  checkouts. Resolve the dir with getSocketRepoClonesDir().',
      '',
    ].join('\n'),
  )
}

// withBashGuard handles the stdin drain, tool_name gate, command narrow, and
// fail-open on any throw. This is a -nudge: stderr only, never exitCode 2.
await withBashGuard(command => {
  // Arm (2): external `gh` review.
  if (findInvocation(command, { binary: 'gh' })) {
    for (const cmd of commandsFor(command, 'gh')) {
      const repo = externalGhRepo(cmd.args)
      if (repo) {
        nudgeCloneForReview(repo.owner, repo.repo)
        return
      }
    }
  }
  // Arm (1): external `git clone` missing smallest-practical flags.
  for (const cmd of commandsFor(command, 'git')) {
    const result = missingCloneFlags(cmd.args)
    if (result && result.missing.length) {
      nudgeMissingFlags(result.owner, result.repo, result.missing)
      return
    }
  }
})
