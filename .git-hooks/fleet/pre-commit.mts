#!/usr/bin/env node
// Socket Security Pre-commit Hook
//
// Local-defense layer: scans staged files for sensitive content
// before git records the commit. Mandatory enforcement re-runs in
// pre-push for the final gate.
//
// Bypassable: --no-verify skips this hook entirely. Use sparingly
// (hotfixes, history operations, pre-build states).

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  checkOxlintRuleWiringStaged,
  git,
  gitLines,
  normalizePath,
  readFileForScan,
  scanAwsKeys,
  scanCrossRepoPaths,
  scanDocsPnpmFirst,
  scanGitHubTokens,
  scanLoggerLeaks,
  scanNpxDlx,
  scanPackageJsonPnpmOverrides,
  scanPersonalPaths,
  scanPrivateKeys,
  scanSocketApiKeys,
  shouldSkipFile,
  socketHookMarkerFor,
} from '../_shared/helpers.mts'

const logger = getDefaultLogger()

const main = (): number => {
  logger.info('Running Socket Security checks…')
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

  // Commit signing config gate. The commit hasn't been created yet,
  // so we can't verify the signature artifact — only the config that
  // determines whether the commit WILL be signed. Two requirements:
  //   - `commit.gpgsign` must be `true`
  //   - `user.signingkey` must be set
  // If either is missing, refuse the commit. Pre-push catches the
  // artifact side (unsigned commits that somehow slipped past); this
  // gate is the local-config side.
  //
  // Bypass: SOCKET_PRE_COMMIT_ALLOW_UNSIGNED=1. One-shot env var,
  // mirrors the pre-push bypass shape (SOCKET_PRE_PUSH_ALLOW_UNSIGNED).
  if (!process.env['SOCKET_PRE_COMMIT_ALLOW_UNSIGNED']) {
    const gpgsign = git('config', '--get', 'commit.gpgsign').toLowerCase()
    const signingKey = git('config', '--get', 'user.signingkey')
    if (gpgsign !== 'true') {
      logger.fail('commit.gpgsign is not enabled')
      logger.info(`  current: ${gpgsign || '(unset)'}`)
      logger.info('  expected: true')
      logger.info('')
      logger.info('Fix:')
      logger.info('  git config --global commit.gpgsign true')
      logger.info('')
      logger.info('If you have not set up commit signing yet, run:')
      logger.info('  node .claude/hooks/fleet/setup-security-tools/install.mts')
      logger.info(
        'which detects available signing methods (GPG, SSH, 1Password)',
      )
      logger.info('and walks you through the one-time setup.')
      errors++
    } else if (!signingKey) {
      logger.fail('commit.gpgsign=true but user.signingkey is not set')
      logger.info('')
      logger.info('Fix:')
      logger.info('  git config --global user.signingkey <YOUR_KEY_ID>')
      logger.info('')
      logger.info('Or run the setup helper for guided configuration:')
      logger.info('  node .claude/hooks/fleet/setup-security-tools/install.mts')
      errors++
    }
    if (errors > 0) {
      logger.info('')
      logger.info(
        'Bypass (exceptional only): SOCKET_PRE_COMMIT_ALLOW_UNSIGNED=1 git commit ...',
      )
      logger.info('One-shot; never persist in shell rc.')
      logger.error('')
      logger.fail(`Pre-commit signing config check failed.`)
      return 1
    }
  }

  // .DS_Store files.
  logger.info('Checking for .DS_Store files…')
  const dsStores = stagedFiles.filter(f => f.includes('.DS_Store'))
  if (dsStores.length > 0) {
    logger.fail('.DS_Store file detected!')
    dsStores.forEach(f => logger.info(f))
    errors++
  }

  // Log files (ignore test logs).
  logger.info('Checking for log files…')
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
  logger.info('Checking for .env files…')
  const envFiles = stagedFiles.filter(f => {
    const base = path.basename(f)
    return (
      /^\.env(?:\.[^/]+)?$/.test(base) &&
      !/^\.env\.(?:example|test|precommit)$/.test(base)
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
  logger.info('Checking for hardcoded personal paths…')
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
  logger.info('Checking for API keys…')
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
  logger.info('Checking for potential secrets…')
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

  // package.json pnpm.overrides — overrides belong in
  // pnpm-workspace.yaml overrides:, not package.json.
  logger.info('Checking for package.json pnpm.overrides...')
  for (const file of stagedFiles) {
    if (path.basename(file) !== 'package.json' || shouldSkipFile(file)) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const ov = scanPackageJsonPnpmOverrides(text)
    if (ov.length > 0) {
      logger.fail(`pnpm.overrides found in: ${file}`)
      logger.info(`${ov[0]!.lineNumber}:${ov[0]!.line}`)
      logger.info(
        'Move dependency overrides to pnpm-workspace.yaml `overrides:`.',
      )
      errors++
    }
  }

  // npx/dlx usage.
  logger.info('Checking for npx/dlx usage…')
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

  // Documentation pnpm-first scanner (warning, not blocking).
  //
  // Fleet rule: user-facing install commands in docs lead with the
  // pnpm form. npm/yarn fallbacks come after. Block-only — inline
  // backtick spans are not scanned. Suppress per-block with
  // `socket-hook: allow pnpm-first`.
  logger.info('Checking docs lead with pnpm install commands…')
  for (const file of stagedFiles) {
    if (shouldSkipFile(file)) {
      continue
    }
    if (!/\.(?:md|mdx)$/i.test(file)) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const hits = scanDocsPnpmFirst(text)
    if (hits.length > 0) {
      logger.warn(`docs without pnpm-first install command: ${file}`)
      for (const h of hits.slice(0, 3)) {
        logger.info(`${h.lineNumber}: ${h.line.trim()}`)
        if (h.suggested && h.suggested !== h.line) {
          logger.info(`     fix: ${h.suggested.trim()}`)
        }
      }
      logger.info(
        'Lead with the pnpm form; keep npm/yarn as fallbacks. To ' +
          'suppress a fenced block, include `socket-hook: allow ' +
          'pnpm-first` anywhere in the block.',
      )
    }
  }

  // Direct stream writes (process.stderr.write, process.stdout.write,
  // console.*) in source files. Source code uses getDefaultLogger()
  // from @socketsecurity/lib-stable/logger/default; the logger-guard PreToolUse hook
  // catches these at edit time, this gate catches them at commit time
  // for edits made outside Claude.
  logger.info('Checking for direct stream writes…')
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
      file.includes('/upstream/') ||
      // src/logger/ IS the logger — implementing the surface itself
      // requires direct console.* calls. Same exemption the
      // logger-guard PreToolUse hook applies.
      file.startsWith('src/logger/')
    ) {
      continue
    }
    if (!/\.(?:m?ts|tsx|cts)$/.test(file)) {
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
        'Use `getDefaultLogger()` from `@socketsecurity/lib-stable/logger/default`. ' +
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
  logger.info('Checking for cross-repo path references…')
  // Best-effort current repo name from the toplevel directory; if git
  // isn't reachable we simply don't suppress own-repo matches.
  const repoTopline = gitLines('rev-parse', '--show-toplevel')[0] ?? ''
  const currentRepoName = repoTopline ? path.basename(repoTopline) : undefined
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
          'Import via the published npm package instead (`@socketsecurity/lib-stable/<subpath>`, ' +
          `\`@socketsecurity/registry-stable/<subpath>\`). For documentation lines that need the ` +
          `literal path, append the marker \`${socketHookMarkerFor(file, 'cross-repo')}\`.`,
      )
      errors++
    }
  }

  // oxlint plugin rule WIRING gate. When a rule file / plugin index /
  // oxlintrc activation / rule test is staged, confirm the wiring triad
  // (rule file → import+registry → activation → test) is complete. A
  // half-wired rule sits silently dormant fleet-wide; this catches it at
  // commit time, not just in a PR (many commits land without one). No-ops
  // unless a wiring-relevant file is staged + the generator is present
  // (so it only runs in the wheelhouse, where the rule files live).
  logger.info('Checking oxlint plugin rule wiring…')
  const wiringRoot = repoTopline || process.cwd()
  const wiringDrift = checkOxlintRuleWiringStaged(stagedFiles, wiringRoot)
  if (wiringDrift) {
    logger.fail('oxlint plugin rule wiring is out of sync.')
    for (const line of wiringDrift.split('\n').slice(0, 8)) {
      logger.info(line)
    }
    logger.info(
      'Run `pnpm run sync-oxlint-rules` to regenerate the import/registry + ' +
        'oxlintrc activations. A missing `test/<rule>.test.mts` must be ' +
        'hand-written (the rule + registration + test triad must be complete).',
    )
    errors++
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
