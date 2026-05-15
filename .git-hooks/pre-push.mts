#!/usr/bin/env node
// Socket Security Pre-push Hook
//
// Mandatory enforcement layer for all pushes. Validates commits
// being pushed for AI attribution, secrets, and personal-path leaks.
//
// Architecture:
//   .git-hooks/pre-push (shell shim, invoked by git when
//   `core.hooksPath = .git-hooks`) → node .git-hooks/pre-push.mts
//
// Range logic:
//   New branch:  remote/<default_branch>..<local_sha>  (only new commits)
//   Existing:    <remote_sha>..<local_sha>             (only new commits)
//   We never use release tags — that would re-scan already-merged history.
//
// Stdin format (provided by git): one push line per ref, each line:
//   <local_ref> <local_sha> <remote_ref> <remote_sha>

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

import { basename } from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import {
  containsAiAttribution,
  git,
  gitLines,
  readFileForScan,
  normalizePath,
  scanAwsKeys,
  scanCrossRepoPaths,
  scanGitHubTokens,
  scanLoggerLeaks,
  scanPersonalPaths,
  scanPrivateKeys,
  scanSocketApiKeys,
  shouldSkipFile,
  socketHookMarkerFor,
  splitLines,
} from './_helpers.mts'

const logger = getDefaultLogger()

const ZERO_SHA = '0000000000000000000000000000000000000000'

const readStdin = (): Promise<string> =>
  new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buf += chunk
    })
    process.stdin.on('end', () => resolve(buf))
  })

// Submodule pristine check — refuses push if any submodule has a
// drifted commit pointer or unresolved merge conflict.
const checkSubmodules = (): number => {
  if (!existsSync('.gitmodules')) {
    return 0
  }
  logger.info('Checking submodules are pristine...')
  let errors = 0
  const status = gitLines('submodule', 'status')
  for (const line of status) {
    if (!line) {
      continue
    }
    const prefix = line[0]
    const rest = line.slice(1).trim().split(/\s+/)
    const smPath = rest[1] || '<unknown>'
    if (prefix === '+') {
      logger.fail(`Submodule has wrong commit: ${smPath}`)
      logger.info(`  Run: git submodule update --init ${smPath}`)
      errors++
    } else if (prefix === 'U') {
      logger.fail(`Submodule has merge conflict: ${smPath}`)
      errors++
    }
    // '-' (uninitialized) is OK — CI shallow clones skip submodules.
  }
  if (errors > 0) {
    logger.error('')
    logger.fail(`Push blocked: ${errors} submodule(s) not pristine!`)
    logger.error('Fix submodules before pushing.')
    return errors
  }
  logger.success('All submodules pristine')
  return 0
}

// Computes the commit range to scan. Returns null if no scan needed
// (skip case — tag, delete, or no baseline).
const computeRange = (
  remote: string,
  localRef: string,
  localSha: string,
  remoteSha: string,
): string | null => {
  if (localRef.startsWith('refs/tags/')) {
    logger.info(`Skipping tag push: ${localRef}`)
    return null
  }
  if (localSha === ZERO_SHA) {
    return null
  }

  const defaultBranchOf = (remoteName: string): string => {
    const sym = git('symbolic-ref', `refs/remotes/${remoteName}/HEAD`).trim()
    if (sym) {
      return sym.replace(`refs/remotes/${remoteName}/`, '')
    }
    return 'main'
  }

  // git cat-file -e exits 0 silently on success; spawnSync directly
  // so we can inspect status without printing.
  const remoteShaExists = (sha: string): boolean => {
    const result = spawnSync('git', ['cat-file', '-e', sha])
    return result.status === 0
  }

  const refExists = (ref: string): boolean => {
    const r = spawnSync('git', ['rev-parse', ref])
    return r.status === 0
  }

  if (remoteSha === ZERO_SHA) {
    // New branch — compare against remote default branch.
    const def = defaultBranchOf(remote)
    const baseRef = `${remote}/${def}`
    if (!refExists(baseRef)) {
      logger.success('Skipping validation (no baseline to compare against)')
      return null
    }
    return `${baseRef}..${localSha}`
  }

  // Existing branch.
  if (!remoteShaExists(remoteSha)) {
    // Force-push or history rewrite — fall back to default branch.
    const def = defaultBranchOf(remote)
    const baseRef = `${remote}/${def}`
    if (!refExists(baseRef)) {
      logger.success('Skipping validation (no baseline for force-push)')
      return null
    }
    return `${baseRef}..${localSha}`
  }
  return `${remoteSha}..${localSha}`
}

// Scans every commit in the range for AI attribution in commit
// messages.
const scanCommitMessages = (range: string): number => {
  logger.info('Checking commit messages for AI attribution...')
  const shas = gitLines('rev-list', range)
  let errors = 0
  for (const sha of shas) {
    if (!sha) {
      continue
    }
    const msg = git('log', '-1', '--format=%B', sha)
    if (containsAiAttribution(msg)) {
      if (errors === 0) {
        logger.fail('AI attribution found in commit messages!')
        logger.info('Commits with AI attribution:')
      }
      const oneline = git('log', '-1', '--oneline', sha)
      logger.info(`  - ${oneline}`)
      errors++
    }
  }
  if (errors > 0) {
    logger.info('')
    logger.info(
      'These commits were likely created with --no-verify, bypassing the',
    )
    logger.info('commit-msg hook that strips AI attribution.')
    logger.info('')
    const rangeBase = range.split('..')[0]
    logger.info('To fix:')
    logger.info(`  git rebase -i ${rangeBase}`)
    logger.info("  Mark commits as 'reword', remove AI attribution, save")
    logger.info('  git push')
  }
  return errors
}

// Scans changed files in the range for secrets, keys, and leaks.
const scanFilesInRange = (range: string): number => {
  logger.info('Checking files for security issues...')
  // Normalize to POSIX forward slashes — same reason as pre-commit.mts.
  const changed = gitLines('diff', '--name-only', range).map(normalizePath)
  let errors = 0
  if (changed.length === 0) {
    return 0
  }
  // Best-effort current repo name — used by cross-repo scanner to
  // avoid flagging a repo's own paths.
  const repoTopline = gitLines('rev-parse', '--show-toplevel')[0] ?? ''
  const currentRepoName = repoTopline ? basename(repoTopline) : undefined

  // .env files at any depth — match commit-msg.mts and pre-commit.mts.
  // Allow .env.example, .env.test, .env.precommit (templates / tracked
  // placeholders); block bare .env / .env.local / .env.production /
  // anything else regardless of directory depth.
  const envHits = changed.filter(f => {
    const base = basename(f)
    return (
      /^\.env(\.[^/]+)?$/.test(base) &&
      !/^\.env\.(example|test|precommit)$/.test(base)
    )
  })
  if (envHits.length > 0) {
    logger.fail('Attempting to push .env file!')
    logger.info(`Files: ${envHits.join(', ')}`)
    errors += envHits.length
  }
  const dsHits = changed.filter(f => f.includes('.DS_Store'))
  if (dsHits.length > 0) {
    logger.fail('.DS_Store file in push!')
    logger.info(`Files: ${dsHits.join(', ')}`)
    errors += dsHits.length
  }
  const logHits = changed.filter(
    f => f.endsWith('.log') && !/test.*\.log$/.test(f),
  )
  if (logHits.length > 0) {
    logger.fail('Log file in push!')
    logger.info(`Files: ${logHits.join(', ')}`)
    errors += logHits.length
  }

  // Per-file content scans.
  for (const file of changed) {
    if (!file || !existsSync(file)) {
      continue
    }
    try {
      if (statSync(file).isDirectory()) {
        continue
      }
    } catch {
      continue
    }
    if (shouldSkipFile(file)) {
      continue
    }
    // Tracked-only — skip files removed from git that still exist on disk.
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', file])
    if (tracked.status !== 0) {
      continue
    }

    const text = readFileForScan(file)
    if (!text) {
      continue
    }

    const pathHits = scanPersonalPaths(text)
    if (pathHits.length > 0) {
      logger.fail(`Hardcoded personal path found in: ${file}`)
      for (const h of pathHits.slice(0, 3)) {
        logger.info(`${h.lineNumber}: ${h.line.trim()}`)
        if (h.suggested && h.suggested !== h.line) {
          logger.info(`     fix: ${h.suggested.trim()}`)
        }
      }
      logger.info(
        'Replace with the canonical placeholder for the path platform: ' +
          '`/Users/<user>/...` (macOS), `/home/<user>/...` (Linux), or ' +
          '`C:\\Users\\<USERNAME>\\...` (Windows). Env vars also work ' +
          '(`$HOME`, `${USER}`). For documentation lines that need the ' +
          `literal form, append the marker \`${socketHookMarkerFor(file, 'personal-path')}\`.`,
      )
      errors++
    }

    const apiHits = scanSocketApiKeys(text)
    if (apiHits.length > 0) {
      logger.fail(`Real API key detected in: ${file}`)
      apiHits
        .slice(0, 3)
        .forEach(h => logger.info(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const awsHits = scanAwsKeys(text)
    if (awsHits.length > 0) {
      logger.fail(`Potential AWS credentials found in: ${file}`)
      awsHits
        .slice(0, 3)
        .forEach(h => logger.info(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const ghHits = scanGitHubTokens(text)
    if (ghHits.length > 0) {
      logger.fail(`Potential GitHub token found in: ${file}`)
      ghHits
        .slice(0, 3)
        .forEach(h => logger.info(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const pkHits = scanPrivateKeys(text)
    if (pkHits.length > 0) {
      logger.fail(`Private key found in: ${file}`)
      errors++
    }

    if (
      !file.startsWith('.claude/hooks/') &&
      !file.startsWith('.git-hooks/') &&
      !file.startsWith('scripts/') &&
      // template/ holds the canonical sources that cascade to
      // .claude/hooks/, .git-hooks/, and scripts/ in downstream
      // fleet repos. The same exemption that applies at the
      // destination has to apply at the source; otherwise wheelhouse
      // template edits get flagged for code that's intentionally raw
      // where it actually runs.
      !file.startsWith('template/.claude/hooks/') &&
      !file.startsWith('template/.git-hooks/') &&
      !file.startsWith('template/scripts/') &&
      !file.includes('/external/') &&
      !file.includes('/vendor/') &&
      !file.includes('/upstream/') &&
      /\.(m?ts|tsx|cts)$/.test(file)
    ) {
      const loggerHits = scanLoggerLeaks(text)
      if (loggerHits.length > 0) {
        logger.fail(`direct stream write found in: ${file}`)
        for (const h of loggerHits.slice(0, 3)) {
          logger.info(`${h.lineNumber}: ${h.line.trim()}`)
          if (h.suggested && h.suggested !== h.line) {
            logger.info(`     fix: ${h.suggested.trim()}`)
          }
        }
        logger.info(
          'Use `getDefaultLogger()` from `@socketsecurity/lib/logger`. ' +
            'For documentation lines that need the literal call, append ' +
            `the marker \`${socketHookMarkerFor(file, 'logger')}\`.`,
        )
        errors++
      }
    }

    // Cross-repo path references — both relative (`../<fleet-repo>/…`)
    // and absolute (`…/projects/<fleet-repo>/…`) forms.
    //
    // Markdown is exempt: docs legitimately show cross-repo command
    // examples (e.g. `node scripts/foo.mts --target ../socket-lib`)
    // and re-emitting them with `@socketsecurity/lib/…` would break
    // the example's runnability. The codepath rule still applies to
    // actual source files.
    if (
      !file.startsWith('.git-hooks/') &&
      !file.startsWith('.claude/hooks/') &&
      !file.endsWith('.md') &&
      !file.includes('/external/') &&
      !file.includes('/vendor/') &&
      !file.includes('/upstream/') &&
      file !== 'pnpm-lock.yaml' &&
      file !== 'pnpm-workspace.yaml'
    ) {
      const crossRepoHits = scanCrossRepoPaths(text, currentRepoName)
      if (crossRepoHits.length > 0) {
        logger.fail(`cross-repo path reference in: ${file}`)
        for (const h of crossRepoHits.slice(0, 3)) {
          logger.info(`${h.lineNumber}: ${h.line.trim()}`)
        }
        logger.info(
          'Cross-repo paths are forbidden — import via the published npm ' +
            'package (`@socketsecurity/lib/<subpath>`) instead. For doc ' +
            `lines, append \`${socketHookMarkerFor(file, 'cross-repo')}\`.`,
        )
        errors++
      }
    }
  }
  return errors
}

const main = async (): Promise<number> => {
  logger.info('Running mandatory pre-push validation...')

  const submoduleErrors = checkSubmodules()
  if (submoduleErrors > 0) {
    return 1
  }

  const remote = process.argv[2] || 'origin'
  // url at process.argv[3] is unused.

  const stdin = await readStdin()
  let totalErrors = 0
  const refLines = splitLines(stdin.trim()).filter(Boolean)

  for (const refLine of refLines) {
    const [localRef, localSha, , remoteSha] = refLine.split(/\s+/)
    if (!localRef || !localSha || !remoteSha) {
      continue
    }
    const range = computeRange(remote, localRef, localSha, remoteSha)
    if (range === null) {
      continue
    }
    // Validate range.
    const rl = spawnSync('git', ['rev-list', range], { stdio: 'ignore' })
    if (rl.status !== 0) {
      logger.fail(`Invalid commit range: ${range}`)
      return 1
    }

    totalErrors += scanCommitMessages(range)
    totalErrors += scanFilesInRange(range)
  }

  if (totalErrors > 0) {
    logger.error('')
    logger.fail('Push blocked by mandatory validation!')
    logger.error('Fix the issues above before pushing.')
    return 1
  }

  logger.success('All mandatory validation passed!')
  return 0
}

// Explicit .catch so a thrown error in main() doesn't become an
// unhandled rejection — surface the error through the logger so the
// user sees what blocked the push, then exit 1 intentionally.
main().then(
  code => process.exit(code),
  e => {
    logger.error(`pre-push: ${errorMessage(e)}`)
    process.exit(1)
  },
)
