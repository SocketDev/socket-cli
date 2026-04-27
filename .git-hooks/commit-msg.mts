#!/usr/bin/env node
// Socket Security Commit-msg Hook
//
// Three responsibilities:
//   1. Block commits that introduce API keys / .env files (security
//      layer that runs even when pre-commit is bypassed via
//      `--no-verify`).
//   2. Block commits whose message references Linear issues — Socket
//      keeps Linear tracking out of git history per CLAUDE.md.
//   3. Auto-strip AI attribution lines from the commit message before
//      git records the commit.
//
// Wired via .husky/commit-msg, which invokes this with the path to the
// commit message file as argv[2] (after the script path itself).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { basename } from 'node:path'
import process from 'node:process'

import {
  err,
  gitLines,
  green,
  out,
  red,
  readFileForScan,
  scanLinearReferences,
  scanSocketApiKeys,
  shouldSkipFile,
  stripAiAttribution,
} from './_helpers.mts'

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
      out(red('✗ SECURITY: Potential API key detected in commit!'))
      out(`File: ${file}`)
      errors++
    }

    // .env files at any depth — allow only .env.example, .env.test,
    // .env.precommit (templates / tracked placeholders).
    const base = basename(file)
    if (
      /^\.env(\.[^/]+)?$/.test(base) &&
      !/^\.env\.(example|test|precommit)$/.test(base)
    ) {
      out(red('✗ SECURITY: .env file in commit!'))
      out(`File: ${file}`)
      errors++
    }
  }

  const commitMsgFile = process.argv[2]
  if (commitMsgFile && existsSync(commitMsgFile)) {
    const original = readFileSync(commitMsgFile, 'utf8')

    // Block Linear issue references in the commit message. Socket
    // keeps Linear tracking out of git history; commit messages stay
    // tool-agnostic.
    const linearHits = scanLinearReferences(original)
    if (linearHits.length > 0) {
      out(red('✗ Commit message references Linear issue(s):'))
      for (const hit of linearHits) {
        out(`  ${hit}`)
      }
      out(
        red(
          'Linear tracking lives in Linear. Remove the reference from the commit message.',
        ),
      )
      errors++
    }

    // Auto-strip AI attribution lines from the commit message.
    const { cleaned, removed } = stripAiAttribution(original)
    if (removed > 0) {
      writeFileSync(commitMsgFile, cleaned)
      out(
        `${green('✓ Auto-stripped')} ${removed} AI attribution line(s) from commit message`,
      )
    }
  }

  if (errors > 0) {
    err(red('✗ Commit blocked by security validation'))
    return 1
  }
  return 0
}

process.exit(main())
