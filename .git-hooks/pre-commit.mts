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

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  gitLines,
  normalizePath,
  readFileForScan,
  scanAwsKeys,
  scanCrossRepoPaths,
  scanGitHubTokens,
  scanLoggerLeaks,
  scanNpxDlx,
  scanPersonalPaths,
  scanPrivateKeys,
  scanSocketApiKeys,
  shouldSkipFile,
  socketHookMarkerFor,
} from './_helpers.mts'

const logger = getDefaultLogger()

const main = (): number => {
  logger.info('Running Socket Security checks...')
  // Normalize to POSIX forward slashes so downstream
  // `startsWith('.git-hooks/')` / `includes('/external/')` matchers
  // work the same on Windows (where git can return `\` separators).
  const stagedFiles = gitLines(
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACM',
  ).map(normalizePath)
  if (stagedFiles.length === 0) {
    logger.success('No files to check')
    return 0
  }

  let errors = 0

  // .DS_Store files.
  logger.info('Checking for .DS_Store files...')
  const dsStores = stagedFiles.filter(f => f.includes('.DS_Store'))
  if (dsStores.length > 0) {
    logger.fail('.DS_Store file detected!')
    dsStores.forEach(f => logger.info(f))
    errors++
  }

  // Log files (ignore test logs).
  logger.info('Checking for log files...')
  const logs = stagedFiles.filter(
    f => f.endsWith('.log') && !/test.*\.log$/.test(f),
  )
  if (logs.length > 0) {
    logger.fail('Log file detected!')
    logs.forEach(f => logger.info(f))
    errors++
  }

  // .env files at any depth — allow only .env.example, .env.test,
  // .env.precommit (templates / tracked placeholders). Match the
  // commit-msg.mts behavior: a nested .env.local is just as much a
  // leak as a root-level one. basename() catches both.
  logger.info('Checking for .env files...')
  const envFiles = stagedFiles.filter(f => {
    const base = basename(f)
    return (
      /^\.env(\.[^/]+)?$/.test(base) &&
      !/^\.env\.(example|test|precommit)$/.test(base)
    )
  })
  if (envFiles.length > 0) {
    logger.fail('.env file detected!')
    envFiles.forEach(f => logger.info(f))
    logger.info(
      'These files should never be committed. Use .env.example for templates.',
    )
    errors++
  }

  // Hardcoded personal paths.
  logger.info('Checking for hardcoded personal paths...')
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
      logger.fail(`Hardcoded personal path found in: ${file}`)
      for (const h of hits.slice(0, 3)) {
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
  }

  // Socket API keys (warning, not blocking).
  logger.info('Checking for API keys...')
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
      logger.warn(`Potential API key found in: ${file}`)
      hits
        .slice(0, 3)
        .forEach(h => logger.info(`${h.lineNumber}:${h.line.trim()}`))
      logger.info('If this is a real API key, DO NOT COMMIT IT.')
    }
  }

  // Other secret patterns (AWS, GitHub, private keys).
  logger.info('Checking for potential secrets...')
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
      logger.fail(`Potential AWS credentials found in: ${file}`)
      aws
        .slice(0, 3)
        .forEach(h => logger.info(`${h.lineNumber}:${h.line.trim()}`))
      errors++
    }

    const gh = scanGitHubTokens(text)
    if (gh.length > 0) {
      logger.fail(`Potential GitHub token found in: ${file}`)
      gh.slice(0, 3).forEach(h =>
        logger.info(`${h.lineNumber}:${h.line.trim()}`),
      )
      errors++
    }

    const pk = scanPrivateKeys(text)
    if (pk.length > 0) {
      logger.fail(`Private key found in: ${file}`)
      errors++
    }
  }

  // npx/dlx usage.
  logger.info('Checking for npx/dlx usage...')
  for (const file of stagedFiles) {
    // shouldSkipFile covers tests, fixtures, .git-hooks, etc. — test
    // files frequently mention `npx` as part of fixture paths or
    // resolution-logic test cases (see socket-lib/test/unit/bin.test.mts).
    if (shouldSkipFile(file)) {
      continue
    }
    if (
      file.endsWith('pnpm-lock.yaml') ||
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
      logger.fail(`npx/dlx usage found in: ${file}`)
      for (const h of hits.slice(0, 3)) {
        logger.info(`${h.lineNumber}: ${h.line.trim()}`)
        if (h.suggested && h.suggested !== h.line) {
          logger.info(`     fix: ${h.suggested.trim()}`)
        }
      }
      logger.info(
        "Use 'pnpm exec <package>' or 'pnpm run <script>' instead. For " +
          'documentation lines that need the literal `npx` form, append ' +
          `the marker \`${socketHookMarkerFor(file, 'npx')}\`.`,
      )
      errors++
    }
  }

  // Direct stream writes (process.stderr.write, process.stdout.write,
  // console.*) in source files. Source code uses getDefaultLogger()
  // from @socketsecurity/lib/logger; the logger-guard PreToolUse hook
  // catches these at edit time, this gate catches them at commit time
  // for edits made outside Claude.
  logger.info('Checking for direct stream writes...')
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
      // template/ is the canonical source for code that cascades to
      // .claude/hooks/, .git-hooks/, and scripts/. Apply the same
      // exemption at the source.
      file.startsWith('template/.claude/hooks/') ||
      file.startsWith('template/.git-hooks/') ||
      file.startsWith('template/scripts/') ||
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
      logger.fail(`direct stream write found in: ${file}`)
      for (const h of hits.slice(0, 3)) {
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

  // Cross-repo path references — `../<fleet-repo>/…` (relative escape
  // out of the current repo) or `…/projects/<fleet-repo>/…` (absolute
  // sibling-clone escape). Both forms hardcode someone's local layout
  // and break in CI / fresh clones / non-standard checkouts.
  logger.info('Checking for cross-repo path references...')
  // Best-effort current repo name from the toplevel directory; if git
  // isn't reachable we simply don't suppress own-repo matches.
  const repoTopline = gitLines('rev-parse', '--show-toplevel')[0] ?? ''
  const currentRepoName = repoTopline ? basename(repoTopline) : undefined
  for (const file of stagedFiles) {
    if (shouldSkipFile(file)) {
      continue
    }
    // Don't scan the hook source itself (it lists fleet repo names by
    // necessity), markdown docs (which legitimately show cross-repo
    // command examples like `--target ../socket-lib`), or vendored
    // upstream sources.
    if (
      file.startsWith('.git-hooks/') ||
      file.startsWith('.claude/hooks/') ||
      file.endsWith('.md') ||
      file.includes('/external/') ||
      file.includes('/vendor/') ||
      file.includes('/upstream/') ||
      file === 'pnpm-lock.yaml' ||
      file === 'pnpm-workspace.yaml'
    ) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const hits = scanCrossRepoPaths(text, currentRepoName)
    if (hits.length > 0) {
      logger.fail(`cross-repo path reference found in: ${file}`)
      for (const h of hits.slice(0, 3)) {
        logger.info(`${h.lineNumber}: ${h.line.trim()}`)
      }
      logger.info(
        'Cross-repo paths (`../<fleet-repo>/…` or absolute `…/projects/<fleet-repo>/…`) ' +
          'are forbidden — they assume sibling-clone layout and break in CI / fresh clones. ' +
          'Import via the published npm package instead (`@socketsecurity/lib/<subpath>`, ' +
          `\`@socketsecurity/registry/<subpath>\`). For documentation lines that need the ` +
          `literal path, append the marker \`${socketHookMarkerFor(file, 'cross-repo')}\`.`,
      )
      errors++
    }
  }

  if (errors > 0) {
    logger.error('')
    logger.fail(`Security check failed with ${errors} error(s).`)
    logger.error('Fix the issues above and try again.')
    return 1
  }

  logger.success('All security checks passed!')
  return 0
}

process.exit(main())
