#!/usr/bin/env node
// Socket Security Pre-push Hook
//
// Mandatory enforcement layer for all pushes. Validates commits
// being pushed for AI attribution, secrets, and personal-path leaks.
//
// Architecture:
//   .husky/pre-push (thin wrapper) → node .git-hooks/pre-push.mts
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

import process from 'node:process'

import {
  containsAiAttribution,
  err,
  git,
  gitLines,
  green,
  out,
  red,
  readFileForScan,
  scanAwsKeys,
  scanGitHubTokens,
  scanPersonalPaths,
  scanPrivateKeys,
  scanSocketApiKeys,
  shouldSkipFile,
} from './_helpers.mts'

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
  out('Checking submodules are pristine...')
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
      out(red(`✗ BLOCKED: Submodule has wrong commit: ${smPath}`))
      out(`  Run: git submodule update --init ${smPath}`)
      errors++
    } else if (prefix === 'U') {
      out(red(`✗ BLOCKED: Submodule has merge conflict: ${smPath}`))
      errors++
    }
    // '-' (uninitialized) is OK — CI shallow clones skip submodules.
  }
  if (errors > 0) {
    err('')
    err(red(`✗ Push blocked: ${errors} submodule(s) not pristine!`))
    err('Fix submodules before pushing.')
    return errors
  }
  out(green('✓ All submodules pristine'))
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
    out(green(`Skipping tag push: ${localRef}`))
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
      out(green('✓ Skipping validation (no baseline to compare against)'))
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
      out(green('✓ Skipping validation (no baseline for force-push)'))
      return null
    }
    return `${baseRef}..${localSha}`
  }
  return `${remoteSha}..${localSha}`
}

// Scans every commit in the range for AI attribution in commit
// messages.
const scanCommitMessages = (range: string): number => {
  out('Checking commit messages for AI attribution...')
  const shas = gitLines('rev-list', range)
  let errors = 0
  for (const sha of shas) {
    if (!sha) {
      continue
    }
    const msg = git('log', '-1', '--format=%B', sha)
    if (containsAiAttribution(msg)) {
      if (errors === 0) {
        out(red('✗ BLOCKED: AI attribution found in commit messages!'))
        out('Commits with AI attribution:')
      }
      const oneline = git('log', '-1', '--oneline', sha)
      out(`  - ${oneline}`)
      errors++
    }
  }
  if (errors > 0) {
    out('')
    out('These commits were likely created with --no-verify, bypassing the')
    out('commit-msg hook that strips AI attribution.')
    out('')
    const rangeBase = range.split('..')[0]
    out('To fix:')
    out(`  git rebase -i ${rangeBase}`)
    out("  Mark commits as 'reword', remove AI attribution, save")
    out('  git push')
  }
  return errors
}

// Scans changed files in the range for secrets, keys, and leaks.
const scanFilesInRange = (range: string): number => {
  out('Checking files for security issues...')
  const changed = gitLines('diff', '--name-only', range)
  let errors = 0
  if (changed.length === 0) {
    return 0
  }

  // Top-level sensitive filenames in the change set.
  const envHits = changed.filter(f => /^\.env(\.local)?$/.test(f))
  if (envHits.length > 0) {
    out(red('✗ BLOCKED: Attempting to push .env file!'))
    out(`Files: ${envHits.join(', ')}`)
    errors += envHits.length
  }
  const dsHits = changed.filter(f => f.includes('.DS_Store'))
  if (dsHits.length > 0) {
    out(red('✗ BLOCKED: .DS_Store file in push!'))
    out(`Files: ${dsHits.join(', ')}`)
    errors += dsHits.length
  }
  const logHits = changed.filter(
    f => f.endsWith('.log') && !/test.*\.log$/.test(f),
  )
  if (logHits.length > 0) {
    out(red('✗ BLOCKED: Log file in push!'))
    out(`Files: ${logHits.join(', ')}`)
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
      out(red(`✗ BLOCKED: Hardcoded personal path found in: ${file}`))
      pathHits.slice(0, 3).forEach(h => out(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const apiHits = scanSocketApiKeys(text)
    if (apiHits.length > 0) {
      out(red(`✗ BLOCKED: Real API key detected in: ${file}`))
      apiHits.slice(0, 3).forEach(h => out(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const awsHits = scanAwsKeys(text)
    if (awsHits.length > 0) {
      out(red(`✗ BLOCKED: Potential AWS credentials found in: ${file}`))
      awsHits.slice(0, 3).forEach(h => out(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const ghHits = scanGitHubTokens(text)
    if (ghHits.length > 0) {
      out(red(`✗ BLOCKED: Potential GitHub token found in: ${file}`))
      ghHits.slice(0, 3).forEach(h => out(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const pkHits = scanPrivateKeys(text)
    if (pkHits.length > 0) {
      out(red(`✗ BLOCKED: Private key found in: ${file}`))
      errors++
    }
  }
  return errors
}

const main = async (): Promise<number> => {
  out(green('Running mandatory pre-push validation...'))

  const submoduleErrors = checkSubmodules()
  if (submoduleErrors > 0) {
    return 1
  }

  const remote = process.argv[2] || 'origin'
  // url at process.argv[3] is unused.

  const stdin = await readStdin()
  let totalErrors = 0
  const refLines = stdin.trim().split('\n').filter(Boolean)

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
      err(red(`✗ Invalid commit range: ${range}`))
      return 1
    }

    totalErrors += scanCommitMessages(range)
    totalErrors += scanFilesInRange(range)
  }

  if (totalErrors > 0) {
    err('')
    err(red('✗ Push blocked by mandatory validation!'))
    err('Fix the issues above before pushing.')
    return 1
  }

  out(green('✓ All mandatory validation passed!'))
  return 0
}

main().then(code => process.exit(code))
