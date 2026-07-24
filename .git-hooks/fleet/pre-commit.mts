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
  catastrophicDeletionReason,
  checkOxlintRuleWiringStaged,
  git,
  gitLines,
  mergeInProgress,
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
  scanPrProcessComments,
  scanSoakExcludeDateAnnotations,
  scanSocketApiKeys,
  shouldSkipFile,
  socketLintMarkerFor,
  stagedIndexIsEmpty,
  stripTemplateLayer,
} from '../_shared/helpers.mts'

const logger = getDefaultLogger()

const main = (): number => {
  logger.info('Running Socket Security checks…')
  // Catastrophic mass-deletion gate — FIRST, unconditionally. The PreToolUse
  // mass-delete-guard checked the index when the `git commit` command was seen,
  // but a pre-commit step (lint/test) can stage deletions mid-commit, after
  // that check passed. The index here IS the about-to-commit tree, so this is
  // the last line of defense against a wipe (a wedged pnpm test once staged the
  // whole .claude/ tree for deletion). Runs before the ACM-staged read because
  // a pure-deletion commit has zero ACM files. No bypass — a wipe is never
  // intentional; finish/abort the operation that staged it. A surgical
  // `git commit --only <paths>` sees ONLY the named paths, never a foreign
  // deletion staged elsewhere in the working index — see
  // catastrophicDeletionReason's comment in _shared/helpers.mts for the
  // verified GIT_INDEX_FILE scoping this relies on.
  const wipeReason = catastrophicDeletionReason()
  if (wipeReason) {
    logger.fail('Refusing to commit: catastrophic mass deletion staged.')
    logger.info(`  ${wipeReason}.`)
    logger.info('')
    logger.info('  A pre-commit step (lint/test) or a clobbered index likely')
    logger.info('  staged these deletions. Inspect: git diff --cached --stat')
    logger.info('  | tail. Restore the tree, then commit only what you meant.')
    return 1
  }
  // Empty-commit gate — the commit-time twin of the no-empty-commit-guard
  // PreToolUse hook (which blocks `git commit --allow-empty` at Claude Code
  // tool time). A commit made outside the agent — or one that reaches the index empty
  // for any other reason — must not produce a zero-diff commit: empty commits
  // pollute `git log`, break CHANGELOG generators (which expect each commit to
  // carry a diff), and hide intent. `git diff --cached --quiet` is the
  // canonical emptiness signal (spans every filter, so a pure-deletion commit
  // — already cleared by the catastrophic-deletion gate above — reports
  // non-empty and is allowed through). A merge / cherry-pick / revert in
  // progress legitimately records no staged delta of its own, so it is
  // exempt. Bypass: --no-verify (skips this hook entirely; matches the
  // --allow-empty channel's intent for the rare deliberate waypoint).
  if (stagedIndexIsEmpty() && !mergeInProgress()) {
    logger.fail('Refusing to commit: the staged index is empty.')
    logger.info('  where: git index (nothing staged relative to HEAD)')
    logger.info('  saw:   an empty commit (no file added, changed, or deleted)')
    logger.info('  want:  every commit carries a diff')
    logger.info('')
    logger.info('Fix:')
    logger.info('  stage your change (git add <file>), then commit; or')
    logger.info('  to anchor a release tag forward, tag the real content')
    logger.info('  commit instead: git tag -f vX.Y.Z <real-content-commit>.')
    logger.info('')
    logger.info('  A genuine no-content waypoint needs git commit --no-verify.')
    return 1
  }

  // Normalize to POSIX forward slashes so downstream
  // `startsWith('.git-hooks/')` / `includes('/external/')` matchers
  // work the same on Windows (where git can return `\` separators).
  const stagedFiles = gitLines(
    'diff',
    '--cached',
    '--name-only',
    '--diff-filter=ACM',
  ).map(normalizePath)
  // No add/change/modify staged — but the empty-index gate above already
  // proved the commit is non-empty (a pure-deletion or merge commit). Nothing
  // for the content scanners to read, so the security sweep is a no-op.
  if (stagedFiles.length === 0) {
    logger.success('No files to scan')
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
  // Bypass: SOCKET_PRE_COMMIT_ALLOW_UNSIGNED=1. One-shot env var.
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
    for (let i = 0, { length } = dsStores; i < length; i += 1) {
      logger.info(dsStores[i]!)
    }
    errors++
  }

  // Log files (ignore test logs).
  logger.info('Checking for log files…')
  const logs = stagedFiles.filter(
    f => f.endsWith('.log') && !/test.*\.log$/.test(f),
  )
  if (logs.length > 0) {
    logger.fail('Log file detected!')
    for (let i = 0, { length } = logs; i < length; i += 1) {
      logger.info(logs[i]!)
    }
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
      !/^\.env\.(?:example|precommit|test)$/.test(base)
    )
  })
  if (envFiles.length > 0) {
    logger.fail('.env file detected!')
    for (let i = 0, { length } = envFiles; i < length; i += 1) {
      logger.info(envFiles[i]!)
    }
    logger.info(
      'These files should never be committed. Use .env.example for templates.',
    )
    errors++
  }

  // Hardcoded personal paths.
  logger.info('Checking for hardcoded personal paths…')
  for (let k = 0, { length: klen } = stagedFiles; k < klen; k += 1) {
    const file = stagedFiles[k]!
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
      const hItems2 = hits.slice(0, 3)
      for (let j = 0, { length: jlen } = hItems2; j < jlen; j += 1) {
        const h = hItems2[j]!
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
          `literal form, append the marker \`${socketLintMarkerFor(file, 'personal-path')}\`.`,
      )
      errors++
    }
  }

  // Socket API keys (warning, not blocking).
  logger.info('Checking for API keys…')
  for (let j = 0, { length: jlen } = stagedFiles; j < jlen; j += 1) {
    const file = stagedFiles[j]!
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
      const topHits = hits.slice(0, 3)
      for (let i = 0, { length } = topHits; i < length; i += 1) {
        const h = topHits[i]!
        logger.info(`${h.lineNumber}:${h.line.trim()}`)
      }
      logger.info('If this is a real API key, DO NOT COMMIT IT.')
    }
  }

  // Other secret patterns (AWS, GitHub, private keys).
  logger.info('Checking for potential secrets…')
  for (let j = 0, { length: jlen } = stagedFiles; j < jlen; j += 1) {
    const file = stagedFiles[j]!
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
      const topAws = aws.slice(0, 3)
      for (let i = 0, { length } = topAws; i < length; i += 1) {
        const h = topAws[i]!
        logger.info(`${h.lineNumber}:${h.line.trim()}`)
      }
      errors++
    }

    const gh = scanGitHubTokens(text)
    if (gh.length > 0) {
      logger.fail(`Potential GitHub token found in: ${file}`)
      const topGh = gh.slice(0, 3)
      for (let i = 0, { length } = topGh; i < length; i += 1) {
        const h = topGh[i]!
        logger.info(`${h.lineNumber}:${h.line.trim()}`)
      }
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
  logger.info('Checking for package.json pnpm.overrides…')
  for (let j = 0, { length: jlen } = stagedFiles; j < jlen; j += 1) {
    const file = stagedFiles[j]!
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

  // Soak-exclude date annotations (HARD block, pnpm-workspace.yaml). Every
  // exact-pin soak-bypass entry under `minimumReleaseAgeExclude:` must carry the
  // `# published: YYYY-MM-DD | removable: YYYY-MM-DD` line above it — the 7-day
  // soak is malware protection. The edit-time soak-exclude-date-guard catches
  // Claude edits; pre-push catches non-Claude pushes; this is the commit-time
  // twin so a staged bypass entry can't slip past `git commit`. Scans the staged
  // working-tree content via readFileForScan (parity with the other scanners).
  logger.info('Checking soak-bypass date annotations…')
  if (stagedFiles.includes('pnpm-workspace.yaml')) {
    const text = readFileForScan('pnpm-workspace.yaml')
    if (text) {
      const hits = scanSoakExcludeDateAnnotations(text)
      if (hits.length > 0) {
        logger.fail(
          `${hits.length} soak-bypass entr${hits.length === 1 ? 'y' : 'ies'} in pnpm-workspace.yaml missing the date annotation:`,
        )
        const hItems2 = hits.slice(0, 5)
        for (let j = 0, { length: jlen } = hItems2; j < jlen; j += 1) {
          const h = hItems2[j]!
          logger.info(`  ${h.lineNumber}: ${h.line.trim()}`)
        }
        logger.info(
          '  Add the line above each exact-pin: ' +
            '`# published: YYYY-MM-DD | removable: YYYY-MM-DD` ' +
            '(removable = published + 7d). The 7-day soak is malware protection.',
        )
        errors++
      }
    }
  }

  // npx/dlx usage.
  logger.info('Checking for npx/dlx usage…')
  for (let j = 0, { length: jlen } = stagedFiles; j < jlen; j += 1) {
    const file = stagedFiles[j]!
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
      normalizePath(file).endsWith('/CHANGELOG.md') ||
      // Generated dispatch bundles embed the npx-DETECTING guards
      // themselves — pattern tables plus fix-guidance strings showing
      // real `npx <pkg>` examples. Their SOURCES are scanned; the built
      // artifact is exempt (flagging it blocks every cascade that ships
      // a rebuilt bundle).
      normalizePath(file).endsWith('/hooks/fleet/_dist/bundle.cjs') ||
      normalizePath(file).endsWith('/_dispatch/snapshot-bundle.cjs')
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
      const hItems2 = hits.slice(0, 3)
      for (let i = 0, { length } = hItems2; i < length; i += 1) {
        const h = hItems2[i]!
        logger.info(`${h.lineNumber}: ${h.line.trim()}`)
        if (h.suggested && h.suggested !== h.line) {
          logger.info(`     fix: ${h.suggested.trim()}`)
        }
      }
      logger.info(
        "Use 'pnpm exec <package>' or 'pnpm run <script>' instead. For " +
          'documentation lines that need the literal `npx` form, append ' +
          `the marker \`${socketLintMarkerFor(file, 'npx')}\`.`,
      )
      errors++
    }
  }

  // Documentation pnpm-first scanner (warning, not blocking).
  //
  // Fleet rule: user-facing install commands in docs lead with the
  // pnpm form. npm/yarn fallbacks come after. Block-only — inline
  // backtick spans are not scanned. Suppress per-block with
  // `socket-lint: allow pnpm-first`.
  logger.info('Checking docs lead with pnpm install commands…')
  for (let j = 0, { length: jlen } = stagedFiles; j < jlen; j += 1) {
    const file = stagedFiles[j]!
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
      const hItems2 = hits.slice(0, 3)
      for (let i = 0, { length } = hItems2; i < length; i += 1) {
        const h = hItems2[i]!
        logger.info(`${h.lineNumber}: ${h.line.trim()}`)
        if (h.suggested && h.suggested !== h.line) {
          logger.info(`     fix: ${h.suggested.trim()}`)
        }
      }
      logger.info(
        'Lead with the pnpm form; keep npm/yarn as fallbacks. To ' +
          'suppress a fenced block, include `socket-lint: allow ' +
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
  for (let j = 0, { length: jlen } = stagedFiles; j < jlen; j += 1) {
    const file = stagedFiles[j]!
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
      // The dep-0 bootstrap runs before any dependency exists, so it never
      // imports socket-lib's logger and must call console.* directly — same
      // exemption as scripts/.
      file.startsWith('bootstrap/') ||
      // template/ is the canonical source for code that cascades to
      // .claude/hooks/, .git-hooks/, and scripts/. Apply the same
      // exemption at the source. stripTemplateLayer collapses the
      // archetype layer segment (template/base/... → template/...) so
      // the move stays exempt.
      stripTemplateLayer(file).startsWith('template/.claude/hooks/') ||
      stripTemplateLayer(file).startsWith('template/.git-hooks/') ||
      stripTemplateLayer(file).startsWith('template/scripts/') ||
      stripTemplateLayer(file).startsWith('template/bootstrap/') ||
      normalizePath(file).includes('/external/') ||
      normalizePath(file).includes('/vendor/') ||
      normalizePath(file).includes('/upstream/') ||
      // src/logger/ IS the logger — implementing the surface itself
      // requires direct console.* calls. Same exemption the
      // logger-guard PreToolUse hook applies.
      file.startsWith('src/logger/')
    ) {
      continue
    }
    // Matches TypeScript source extensions: .mts, .ts, .tsx, .cts.
    if (!/\.(?:cts|m?ts|tsx)$/.test(file)) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const hits = scanLoggerLeaks(text)
    if (hits.length > 0) {
      logger.fail(`direct stream write found in: ${file}`)
      const hItems = hits.slice(0, 3)
      for (let i = 0, { length } = hItems; i < length; i += 1) {
        const h = hItems[i]!
        logger.info(`${h.lineNumber}: ${h.line.trim()}`)
        if (h.suggested && h.suggested !== h.line) {
          logger.info(`     fix: ${h.suggested.trim()}`)
        }
      }
      logger.info(
        'Use `getDefaultLogger()` from `@socketsecurity/lib-stable/logger/default`. ' +
          'For documentation lines that need the literal call, append ' +
          `the marker \`${socketLintMarkerFor(file, 'logger')}\`.`,
      )
      errors++
    }
  }

  // Cross-repo path references — `../<fleet-repo>/…` (relative escape
  // out of the current repo) or `…/projects/<fleet-repo>/…` (absolute
  // sibling-clone escape). Both forms hardcode someone's local layout
  // and break in CI / fresh clones / non-standard checkouts.
  logger.info('Checking for cross-repo path references…')
  // Repo toplevel — used below as the wiring root. The cross-repo scanner now
  // derives the repo name per-file from each file's `.git` root.
  const repoTopline = gitLines('rev-parse', '--show-toplevel')[0] ?? ''
  for (let j = 0, { length: jlen } = stagedFiles; j < jlen; j += 1) {
    const file = stagedFiles[j]!
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
      normalizePath(file).includes('/external/') ||
      normalizePath(file).includes('/vendor/') ||
      normalizePath(file).includes('/upstream/') ||
      file === 'pnpm-lock.yaml' ||
      file === 'pnpm-workspace.yaml'
    ) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const hits = scanCrossRepoPaths(text, path.resolve(file))
    if (hits.length > 0) {
      logger.fail(`cross-repo path reference found in: ${file}`)
      const hList = hits.slice(0, 3)
      for (let i = 0, { length } = hList; i < length; i += 1) {
        const h = hList[i]!
        logger.info(`${h.lineNumber}: ${h.line.trim()}`)
      }
      logger.info(
        'Cross-repo paths (`../<fleet-repo>/…` or absolute `…/projects/<fleet-repo>/…`) ' +
          'are forbidden — they assume sibling-clone layout and break in CI / fresh clones. ' +
          'Import via the published npm package instead (`@socketsecurity/lib-stable/<subpath>`, ' +
          `\`@socketsecurity/registry-stable/<subpath>\`). For documentation lines that need the ` +
          `literal path, append the marker \`${socketLintMarkerFor(file, 'cross-repo')}\`.`,
      )
      errors++
    }
  }

  // PR-process / quest / step-N narrative in source COMMENTS (HARD block).
  // Sub-agents wrote point-in-time process references — `//! Step 4 of the net
  // perf quest (#5419) …`, `// Step 2 ([#5638]) replaced …` — into shipping
  // source. Those are meaningless once the PR merges and leak internal process
  // into PUBLIC repos; a comment must read as timeless design rationale, not a
  // changelog of how the code got here. The scanner is comment-text-only (a
  // process word inside a string / identifier never trips it) and confidently
  // blocks the sequence/quest/process-ref shapes; a lone `#N` cross-ref blocks
  // only when it co-occurs with a process word. shouldSkipFile already exempts
  // tests/fixtures (which legitimately quote these shapes). Per-line opt-out:
  // `// socket-lint: allow pr-process-comment`.
  logger.info('Checking comments for PR-process / step-N references…')
  for (let j = 0, { length: jlen } = stagedFiles; j < jlen; j += 1) {
    const file = stagedFiles[j]!
    if (shouldSkipFile(file)) {
      continue
    }
    const text = readFileForScan(file)
    if (!text) {
      continue
    }
    const hits = scanPrProcessComments(text)
    if (hits.length > 0) {
      logger.fail(`PR-process / step-N reference in comment(s) in: ${file}`)
      const hs = hits.slice(0, 3)
      for (let i = 0, { length } = hs; i < length; i += 1) {
        const h = hs[i]!
        logger.info(`${h.lineNumber}: ${h.line.trim()}`)
      }
      logger.info(
        'Rewrite the comment as timeless design rationale (the WHY of the code ' +
          'as it stands), not a record of how it got here. Drop "step N of …" / ' +
          'perf-"quest" sequence markers and process-framed PR/issue refs ' +
          '(`(#1234)`, `[#5638]`, `PR #88`, `added in #41`) — process belongs in ' +
          'the PR description and git history. For a rare legitimate reference, ' +
          `append the marker \`${socketLintMarkerFor(file, 'pr-process-comment')}\`.`,
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
    const lineList = wiringDrift.split('\n').slice(0, 8)
    for (let i = 0, { length } = lineList; i < length; i += 1) {
      const line = lineList[i]!
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

  // Staged tests are run ONCE, by the shell hook's bounded `run_step_bounded
  // test pnpm test --staged` step (PRECOMMIT_STEP_BUDGET_S) — not here. Running
  // them in this security pass too meant the staged delta was tested twice, and
  // this pass used the old 60s ceiling, which is what blew the ≤10s pre-commit
  // budget. The single bounded shell step keeps the commit fast.
  logger.success('All security checks passed!')
  return 0
}

process.exitCode = main()
