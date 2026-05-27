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
} from './_helpers.mts'

const logger = getDefaultLogger()

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
  }

  if (errors > 0) {
    logger.fail('Commit blocked by security validation')
    return 1
  }
  return 0
}

process.exit(main())
