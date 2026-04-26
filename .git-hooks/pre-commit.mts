#!/usr/bin/env node
// Socket Security Pre-commit Hook
//
// Local-defense layer: scans staged files for sensitive content
// before git records the commit. Mandatory enforcement re-runs in
// pre-push for the final gate.
//
// Bypassable: --no-verify skips this hook entirely. Use sparingly
// (hotfixes, history operations, pre-build states).

import process from 'node:process'

import {
  err,
  gitLines,
  green,
  out,
  red,
  readFileForScan,
  scanAwsKeys,
  scanGitHubTokens,
  scanNpxDlx,
  scanPersonalPaths,
  scanPrivateKeys,
  scanSocketApiKeys,
  shouldSkipFile,
  yellow,
} from './_helpers.mts'

const main = (): number => {
  out(green('Running Socket Security checks...'))
  const stagedFiles = gitLines(
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACM',
  )
  if (stagedFiles.length === 0) {
    out(green('✓ No files to check'))
    return 0
  }

  let errors = 0

  // .DS_Store files.
  out('Checking for .DS_Store files...')
  const dsStores = stagedFiles.filter(f => f.includes('.DS_Store'))
  if (dsStores.length > 0) {
    out(red('✗ ERROR: .DS_Store file detected!'))
    dsStores.forEach(f => out(f))
    errors++
  }

  // Log files (ignore test logs).
  out('Checking for log files...')
  const logs = stagedFiles.filter(
    f => f.endsWith('.log') && !/test.*\.log$/.test(f),
  )
  if (logs.length > 0) {
    out(red('✗ ERROR: Log file detected!'))
    logs.forEach(f => out(f))
    errors++
  }

  // .env files (allowlist .env.example / .env.test).
  out('Checking for .env files...')
  const envFiles = stagedFiles.filter(
    f => /^\.env(\.[^/]+)?$/.test(f) && !/^\.env\.(example|test)$/.test(f),
  )
  if (envFiles.length > 0) {
    out(red('✗ ERROR: .env file detected!'))
    envFiles.forEach(f => out(f))
    out(
      'These files should never be committed. Use .env.example for templates.',
    )
    errors++
  }

  // Hardcoded personal paths.
  out('Checking for hardcoded personal paths...')
  for (const file of stagedFiles) {
    if (shouldSkipFile(file)) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const hits = scanPersonalPaths(text)
    if (hits.length > 0) {
      out(red(`✗ ERROR: Hardcoded personal path found in: ${file}`))
      hits.slice(0, 3).forEach(h => out(`${h.lineNumber}:${h.line.trim()}`))
      out('Replace with relative paths or environment variables.')
      errors++
    }
  }

  // Socket API keys (warning, not blocking).
  out('Checking for API keys...')
  for (const file of stagedFiles) {
    if (shouldSkipFile(file)) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const hits = scanSocketApiKeys(text)
    if (hits.length > 0) {
      out(yellow(`⚠ WARNING: Potential API key found in: ${file}`))
      hits.slice(0, 3).forEach(h => out(`${h.lineNumber}:${h.line.trim()}`))
      out('If this is a real API key, DO NOT COMMIT IT.')
    }
  }

  // Other secret patterns (AWS, GitHub, private keys).
  out('Checking for potential secrets...')
  for (const file of stagedFiles) {
    if (shouldSkipFile(file)) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }

    const aws = scanAwsKeys(text)
    if (aws.length > 0) {
      out(red(`✗ ERROR: Potential AWS credentials found in: ${file}`))
      aws.slice(0, 3).forEach(h => out(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const gh = scanGitHubTokens(text)
    if (gh.length > 0) {
      out(red(`✗ ERROR: Potential GitHub token found in: ${file}`))
      gh.slice(0, 3).forEach(h => out(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const pk = scanPrivateKeys(text)
    if (pk.length > 0) {
      out(red(`✗ ERROR: Private key found in: ${file}`))
      errors++
    }
  }

  // npx/dlx usage.
  out('Checking for npx/dlx usage...')
  for (const file of stagedFiles) {
    if (
      file.includes('node_modules/') ||
      file.endsWith('pnpm-lock.yaml') ||
      file.includes('.git-hooks/')
    ) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const hits = scanNpxDlx(text)
    if (hits.length > 0) {
      out(red(`✗ ERROR: npx/dlx usage found in: ${file}`))
      hits.slice(0, 3).forEach(h => out(`${h.lineNumber}:${h.line.trim()}`))
      out("Use 'pnpm exec <package>' or 'pnpm run <script>' instead.")
      errors++
    }
  }

  if (errors > 0) {
    err('')
    err(red(`✗ Security check failed with ${errors} error(s).`))
    err('Fix the issues above and try again.')
    return 1
  }

  out(green('✓ All security checks passed!'))
  return 0
}

process.exit(main())
