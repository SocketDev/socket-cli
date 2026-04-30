#!/usr/bin/env node
// Socket Security Pre-commit Hook
//
// Local-defense layer: scans staged files for sensitive content
// before git records the commit. Mandatory enforcement re-runs in
// pre-push for the final gate.
//
// Bypassable: --no-verify skips this hook entirely. Use sparingly
// (hotfixes, history operations, pre-build states).

import { basename } from 'node:path'
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
  scanLoggerLeaks,
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

  // .env files at any depth — allow only .env.example, .env.test,
  // .env.precommit (templates / tracked placeholders). Match the
  // commit-msg.mts behavior: a nested .env.local is just as much a
  // leak as a root-level one. basename() catches both.
  out('Checking for .env files...')
  const envFiles = stagedFiles.filter(f => {
    const base = basename(f)
    return (
      /^\.env(\.[^/]+)?$/.test(base) &&
      !/^\.env\.(example|test|precommit)$/.test(base)
    )
  })
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
      for (const h of hits.slice(0, 3)) {
        out(`${h.lineNumber}: ${h.line.trim()}`)
        if (h.suggested && h.suggested !== h.line) {
          out(`     fix: ${h.suggested.trim()}`)
        }
      }
      out(
        'Replace with `<user>` / `<USERNAME>` placeholders, an env var ' +
          '(`$HOME`, `${USER}`), or — for documentation lines that need ' +
          'the literal username form — append the marker ' +
          '`# zizmor: documentation-placeholder`.',
      )
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
      file.includes('.git-hooks/') ||
      // CHANGELOG entries discuss npx ecosystem *behavior* (cache
      // semantics, naming conventions) as historical documentation —
      // they're not commands. Skip the npx/dlx scan for changelogs.
      file === 'CHANGELOG.md' ||
      file.endsWith('/CHANGELOG.md')
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
      for (const h of hits.slice(0, 3)) {
        out(`${h.lineNumber}: ${h.line.trim()}`)
        if (h.suggested && h.suggested !== h.line) {
          out(`     fix: ${h.suggested.trim()}`)
        }
      }
      out(
        "Use 'pnpm exec <package>' or 'pnpm run <script>' instead. For " +
          'documentation lines that need the literal `npx` form, append ' +
          'the marker `# socket-hook: allow npx`.',
      )
      errors++
    }
  }

  // Direct stream writes (process.stderr.write, process.stdout.write,
  // console.*) in source files. Source code uses getDefaultLogger()
  // from @socketsecurity/lib/logger; the logger-guard PreToolUse hook
  // catches these at edit time, this gate catches them at commit time
  // for edits made outside Claude.
  out('Checking for direct stream writes...')
  for (const file of stagedFiles) {
    if (shouldSkipFile(file)) {
      continue
    }
    // Apply the same exempt set as the logger-guard hook so the rule
    // is consistent: hooks, git-hooks, scripts, vendored / external
    // sources are allowed. The shouldSkipFile helper covers tests and
    // fixtures already.
    if (
      file.startsWith('.claude/hooks/') ||
      file.startsWith('.git-hooks/') ||
      file.startsWith('scripts/') ||
      file.includes('/external/') ||
      file.includes('/vendor/') ||
      file.includes('/upstream/')
    ) {
      continue
    }
    if (!/\.(m?ts|tsx|cts)$/.test(file)) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const hits = scanLoggerLeaks(text)
    if (hits.length > 0) {
      out(red(`✗ ERROR: direct stream write found in: ${file}`))
      for (const h of hits.slice(0, 3)) {
        out(`${h.lineNumber}: ${h.line.trim()}`)
        if (h.suggested && h.suggested !== h.line) {
          out(`     fix: ${h.suggested.trim()}`)
        }
      }
      out(
        "Use `getDefaultLogger()` from `@socketsecurity/lib/logger`. " +
          'For documentation lines that need the literal call, append ' +
          'the marker `# socket-hook: allow logger`.',
      )
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
