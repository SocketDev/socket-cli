#!/usr/bin/env node
// Socket Security Commit-msg Hook
//
// Two responsibilities:
//   1. Block commits that introduce API keys / .env files (security
//      layer that runs even when pre-commit is bypassed via
//      `--no-verify`).
//   2. Auto-strip AI attribution lines from the commit message before
//      git records the commit.
//
// Wired via .git-hooks/commit-msg (the sibling shell shim), which git
// invokes when `core.hooksPath` points at .git-hooks/ — set by
// `node scripts/install-git-hooks.mts` at `pnpm install` time. The
// shim execs this .mts file with the path to the commit message file
// as argv[2] (after the script path itself).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  gitLines,
  readFileForScan,
  scanGitHubTokens,
  scanLinearRefs,
  scanSocketApiKeys,
  shouldSkipFile,
  stripAiAttribution,
} from '../_shared/helpers.mts'
// Canonical shared identity reader (.git-hooks/_shared/). Same source the
// commit-author-guard PreToolUse hook uses; the DATA is the cascaded
// .config/fleet|repo/git-authors.json.
import {
  isAllowedAuthor,
  isDeniedIdentity,
  readIdentityPolicy,
} from '../_shared/git-identity.mts'
import type { GitAuthor } from '../_shared/git-identity.mts'
import {
  commitSubject,
  isPlaceholderSubject,
} from '../_shared/commit-subject.mts'

const logger = getDefaultLogger()

// Parse `Name <email>` out of a `git var GIT_AUTHOR_IDENT` string
// (`Name <email> <ts> <tz>`).
function parseIdent(ident: string): GitAuthor {
  const m = /^(.*?)\s*<([^>]*)>/.exec(ident)
  return {
    name: m?.[1]?.trim() || undefined,
    email: m?.[2]?.trim() || undefined,
  }
}

function identLabel(which: 'GIT_AUTHOR_IDENT' | 'GIT_COMMITTER_IDENT'): string {
  return which === 'GIT_AUTHOR_IDENT' ? 'author' : 'committer'
}

const main = (): number => {
  let errors = 0
  const committedFiles = gitLines(
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACM',
  )

  for (const file of committedFiles) {
    if (!file || shouldSkipFile(file)) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }

    // Socket API keys (allowlist-aware).
    const apiHits = scanSocketApiKeys(text)
    if (apiHits.length > 0) {
      logger.fail('Potential API key detected in commit!')
      logger.info(`File: ${file}`)
      errors++
    }

    // .env files at any depth — allow only .env.example, .env.test,
    // .env.precommit (templates / tracked placeholders).
    const base = path.basename(file)
    if (
      /^\.env(\.[^/]+)?$/.test(base) &&
      !/^\.env\.(example|precommit|test)$/.test(base)
    ) {
      logger.fail('.env file in commit!')
      logger.info(`File: ${file}`)
      errors++
    }
  }

  // Block Linear issue references in the commit message. Linear
  // tracking lives in Linear; commit history stays tool-agnostic. The
  // canonical CLAUDE.md "public-surface hygiene" block documents the
  // policy; this hook makes it mechanical so a typo in a hot rebase
  // can't slip through.
  const commitMsgFile = process.argv[2]
  if (commitMsgFile && existsSync(commitMsgFile)) {
    const original = readFileSync(commitMsgFile, 'utf8')
    const linearHits = scanLinearRefs(original)
    if (linearHits.length > 0) {
      logger.fail('Commit message references Linear issue(s):')
      for (const ref of linearHits) {
        logger.info(`  ${ref}`)
      }
      logger.info(
        'Linear tracking lives in Linear. Remove the reference from the commit message.',
      )
      errors++
    }

    // GitHub tokens in the commit message body. Pasting a `ghs_*` /
    // `ghp_*` / `ghu_*` token into a commit message is exactly the
    // leak vector commit-msg should block (the body lands in the
    // remote repo's commit-log permanently — can't be unpushed). The
    // scanGitHubTokens regex covers both the classic opaque format
    // and the new JWT format from the 2026-05-15 GitHub rollout.
    const ghHits = scanGitHubTokens(original)
    if (ghHits.length > 0) {
      logger.fail('Commit message contains a potential GitHub token:')
      for (const hit of ghHits.slice(0, 3)) {
        logger.info(`  line ${hit.lineNumber}: ${hit.line.trim()}`)
      }
      logger.info(
        'Remove the token from the commit message. If this is intentional documentation of a token-shape pattern, paste the value into a test fixture instead, not the commit message.',
      )
      errors++
    }

    // Auto-strip AI attribution lines from the commit message.
    const { cleaned, removed } = stripAiAttribution(original)
    if (removed > 0) {
      writeFileSync(commitMsgFile, cleaned)
      logger.success(
        `Auto-stripped ${removed} AI attribution line(s) from commit message`,
      )
    }

    // Placeholder-subject git-stage backstop. The companion
    // no-placeholder-commit-subject-guard catches Claude `git commit -m` tool
    // calls; this catches the same junk subject (`initial`/`wip`/`test`) on a
    // subprocess / worktree / CI / test-harness commit the tool layer misses.
    const subject = commitSubject(cleaned || original)
    if (isPlaceholderSubject(subject)) {
      logger.fail(`Commit blocked: placeholder subject "${subject}".`)
      logger.info(
        'Write a Conventional Commits subject stating what changed (e.g. `fix(scan): handle empty manifest`). Placeholder titles like "initial"/"wip"/"test" are the fingerprint of a test-harness or replayed commit.',
      )
      errors++
    }
  }

  // Git-stage backstop for commit author/committer identity. The
  // commit-author-guard PreToolUse hook checks Claude `git commit` tool
  // calls, but a subprocess / fresh worktree / CI / test-harness commit
  // never routes through that layer — that is how a batch of
  // test@example.com commits once reached a fleet repo's main. This fires on
  // the git commit-msg stage regardless of origin, reading the SAME cascaded
  // .config/fleet|repo/git-authors.json policy so the two never diverge.
  const policy = readIdentityPolicy(process.cwd())
  for (const which of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT'] as const) {
    let ident = ''
    try {
      ident = gitLines('var', which)[0] ?? ''
    } catch {
      // `git var` failed (unusual env) — fail open, don't block a real commit.
      continue
    }
    const who = parseIdent(ident)
    const denied = isDeniedIdentity(who, policy)
    if (denied || !isAllowedAuthor(who, policy)) {
      const id = `${who.name ?? '(unset)'} <${who.email ?? '(unset)'}>`
      logger.fail(
        denied
          ? `Commit blocked: ${identLabel(which)} is a placeholder/sandbox identity ${id}.`
          : `Commit blocked: ${identLabel(which)} ${id} is not on the allowed-author list.`,
      )
      logger.info(
        'Set a real identity (`git config user.email "<you>@<domain>"`). Allowed authors come from .config/repo/git-authors.json (per-repo) over .config/fleet/git-authors.json (cascaded); placeholder identities (test@example.com, Test, …) are never allowed.',
      )
      errors++
    }
  }

  if (errors > 0) {
    logger.fail('Commit blocked by security validation')
    return 1
  }
  return 0
}

process.exit(main())
