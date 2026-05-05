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

  // Auto-strip AI attribution lines from the commit message.
  const commitMsgFile = process.argv[2]
  if (commitMsgFile && existsSync(commitMsgFile)) {
    const original = readFileSync(commitMsgFile, 'utf8')
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
