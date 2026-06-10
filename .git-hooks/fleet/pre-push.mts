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

import { existsSync, readFileSync, statSync } from 'node:fs'

import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  containsAiAttribution,
  git,
  gitLines,
  normalizePath,
  readFileForScan,
  scanAiConfigPoison,
  scanAwsKeys,
  scanCrossRepoPaths,
  scanGitHubTokens,
  scanLoggerLeaks,
  scanPersonalPaths,
  scanPrivateKeys,
  scanProgrammaticClaudeLockdown,
  scanSoakExcludeDateAnnotations,
  scanSocketApiKeys,
  shouldSkipFile,
  socketLintMarkerFor,
  splitLines,
} from '../_shared/helpers.mts'

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
  logger.info('Checking submodules are pristine…')
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
): string | undefined => {
  if (localRef.startsWith('refs/tags/')) {
    logger.info(`Skipping tag push: ${localRef}`)
    return undefined
  }
  if (localSha === ZERO_SHA) {
    return undefined
  }

  const refExists = (ref: string): boolean => {
    const r = spawnSync('git', ['rev-parse', ref])
    return r.status === 0
  }

  const defaultBranchOf = (remoteName: string): string => {
    const sym = git('symbolic-ref', `refs/remotes/${remoteName}/HEAD`).trim()
    if (sym) {
      return sym.replace(`refs/remotes/${remoteName}/`, '')
    }
    // symbolic-ref unset (rare — happens with shallow clones, partial
    // fetches, freshly-init'd remotes). Try main → master → 'main'
    // per CLAUDE.md default-branch resolution. Reversing the order
    // would mispick during rename migrations.
    if (refExists(`${remoteName}/main`)) {
      return 'main'
    }
    if (refExists(`${remoteName}/master`)) {
      return 'master'
    }
    return 'main'
  }

  // git cat-file -e exits 0 silently on success; spawnSync directly
  // so we can inspect status without printing.
  const remoteShaExists = (sha: string): boolean => {
    const result = spawnSync('git', ['cat-file', '-e', sha])
    return result.status === 0
  }

  if (remoteSha === ZERO_SHA) {
    // New branch — compare against remote default branch.
    const def = defaultBranchOf(remote)
    const baseRef = `${remote}/${def}`
    if (!refExists(baseRef)) {
      logger.success('Skipping validation (no baseline to compare against)')
      return undefined
    }
    return `${baseRef}..${localSha}`
  }

  const isAncestor = (ancestor: string, descendant: string): boolean =>
    spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant])
      .status === 0

  // Existing branch.
  if (!remoteShaExists(remoteSha) || !isAncestor(remoteSha, localSha)) {
    // Force-push, history rewrite, or dangling object that is not an
    // ancestor of the local tip — fall back to remote default branch.
    const def = defaultBranchOf(remote)
    const baseRef = `${remote}/${def}`
    if (!refExists(baseRef)) {
      logger.success('Skipping validation (no baseline for force-push)')
      return undefined
    }
    return `${baseRef}..${localSha}`
  }
  return `${remoteSha}..${localSha}`
}

// Scans every commit in the range to require a verified signature
// when pushing to a protected ref (default branch). Block on `N`
// (no signature) and `B` (bad/unverifiable) — but allow other
// markers like `G` (good GPG sig), `U` (good GPG sig, unknown trust),
// `E` (missing-key but otherwise valid), `X` (good signature on
// expired key), `Y`/`R` (revoked/expired key with good signature).
//
// Why pre-push and not just rely on GitHub branch protection? The
// fleet enforces branch protection too (lint-github-settings.mts
// audits `required_signatures: true`), but a local pre-push fail
// gives faster feedback (no round-trip to GitHub) and catches the
// case where branch protection is being set up but not yet active
// on a freshly-created fleet repo.

// Parse the SSH allowed_signers file referenced by
// `git config --get gpg.ssh.allowedSignersFile`. Returns the set of
// public-key BLOBS (the same format `git log --format=%GK` emits for
// SSH-signed commits — `<key-type> <base64-key>`).
//
// Returns an empty set if:
//   - gpg.format isn't 'ssh' (allowed-signers only applies to SSH-format)
//   - gpg.ssh.allowedSignersFile is unset
//   - the file doesn't exist or can't be read
// An empty set means "don't enforce" — the %G? marker check alone
// remains active. This degrades gracefully on first install before
// the user has set up allowed_signers.
const readAllowedSignerKeys = (): Set<string> => {
  const out = new Set<string>()
  try {
    const fmt = git('config', '--get', 'gpg.format').trim()
    if (fmt !== 'ssh') {
      return out
    }
    const file = git('config', '--get', 'gpg.ssh.allowedSignersFile').trim()
    if (!file) {
      return out
    }
    const expanded = file.startsWith('~')
      ? file.replace(/^~/, process.env['HOME'] ?? '')
      : file
    if (!existsSync(expanded)) {
      return out
    }
    // allowed_signers file format: `<principal> [<options>] <key-type> <base64-key>`
    // %GK emits `<key-type> <base64-key>` (no principal). We extract
    // the last two whitespace-separated tokens of each line.
    const text = readFileSync(expanded, 'utf8')
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) {
        continue
      }
      const tokens = line.split(/\s+/)
      if (tokens.length < 3) {
        continue
      }
      const keyType = tokens[tokens.length - 2]!
      const keyBlob = tokens[tokens.length - 1]!
      out.add(`${keyType} ${keyBlob}`)
    }
  } catch {
    // best-effort; absence of allowed-signers shouldn't crash the hook
  }
  return out
}

const scanSignedCommits = (range: string, remoteRef: string): number => {
  // Only enforce on default-branch refs (main / master). Feature
  // branches and topic branches can stay unsigned during development;
  // signing is required at the point of landing on the protected ref.
  const refBase = remoteRef.replace(/^refs\/heads\//, '')
  if (refBase !== 'main' && refBase !== 'master') {
    return 0
  }
  logger.info('Checking commit signatures…')
  // %G? — signature verification marker (G/U/E/X/Y/R/N/B).
  // %GK — signing key fingerprint (empty if unsigned).
  // %GS — signer name (from key user-id).
  // Cross-check %GK against gpg.ssh.allowedSignersFile when configured
  // and `gpg.format = ssh`. For gpg-format signatures, %G? alone
  // reflects the local keyring's trust, which is sufficient for our
  // threat model (the attacker would need to control the dev's
  // ~/.gnupg, at which point the local box is fully owned).
  const lines = gitLines('log', '--format=%H %G? %GK', range)
  const allowedSigners = readAllowedSignerKeys()
  let errors = 0
  const unsigned: string[] = []
  const unauthorized: string[] = []
  for (const line of lines) {
    const parts = line.split(' ')
    const sha = parts[0]
    const marker = parts[1]
    const signerKey = parts.slice(2).join(' ').trim()
    if (!sha || !marker) {
      continue
    }
    // `N` = no signature. `B` = bad signature. Both block.
    if (marker === 'B' || marker === 'N') {
      unsigned.push(sha)
      errors++
      continue
    }
    // Allowed-signers cross-check (SSH-signed commits only). `G`
    // means git verified the signature against SOME key it trusts —
    // but "any trusted key" includes attacker-controlled keys on a
    // compromised dev machine. The authorized-signer file pins down
    // which keys we accept for the protected branch.
    if (
      allowedSigners.size > 0 &&
      signerKey &&
      !allowedSigners.has(signerKey)
    ) {
      unauthorized.push(`${sha} (signed by ${signerKey.slice(0, 16)}…)`)
      errors++
    }
  }
  if (unauthorized.length > 0) {
    logger.error(
      `${unauthorized.length} commit(s) signed by a key NOT in gpg.ssh.allowedSignersFile:`,
    )
    for (let i = 0, { length } = unauthorized; i < length; i += 1) {
      const u = unauthorized[i]!
      logger.error(`  ${u}`)
    }
  }
  if (errors === 0) {
    return 0
  }
  logger.fail(`${errors} unsigned commit(s) being pushed to ${refBase}.`)
  for (const sha of unsigned.slice(0, 5)) {
    const oneline = git('log', '-1', '--oneline', sha)
    logger.info(`  - ${oneline}`)
  }
  if (unsigned.length > 5) {
    logger.info(`  ... and ${unsigned.length - 5} more`)
  }
  logger.info('')
  logger.info('Fix: rebase + re-sign the commits.')
  logger.info(`  git rebase --exec 'git commit --amend --no-edit -S' <base>`)
  return errors
}

// Scans every commit in the range for AI attribution in commit
// messages.
const scanCommitMessages = (range: string): number => {
  logger.info('Checking commit messages for AI attribution…')
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
  logger.info('Checking files for security issues…')
  // Normalize to POSIX forward slashes — same reason as pre-commit.mts.
  const changed = gitLines('diff', '--name-only', range).map(normalizePath)
  let errors = 0
  if (changed.length === 0) {
    return 0
  }
  // Best-effort current repo name — used by cross-repo scanner to
  // avoid flagging a repo's own paths. Fails gracefully in linked
  // worktrees backed by a bare repo (show-toplevel is undefined there).
  let repoTopline = ''
  try {
    repoTopline = gitLines('rev-parse', '--show-toplevel')[0] ?? ''
  } catch {
    // bare repo / worktree context — proceed without a repo name filter
  }
  const currentRepoName = repoTopline ? path.basename(repoTopline) : undefined

  // .env files at any depth — match commit-msg.mts and pre-commit.mts.
  // Allow .env.example, .env.test, .env.precommit (templates / tracked
  // placeholders); block bare .env / .env.local / .env.production /
  // anything else regardless of directory depth.
  const envHits = changed.filter(f => {
    const base = path.basename(f)
    return (
      /^\.env(\.[^/]+)?$/.test(base) &&
      !/^\.env\.(example|precommit|test)$/.test(base)
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
          `literal form, append the marker \`${socketLintMarkerFor(file, 'personal-path')}\`.`,
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
      // src/logger/ IS the logger — implementing the surface itself
      // requires direct console.* calls.
      !file.startsWith('src/logger/') &&
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
          'Use `getDefaultLogger()` from `@socketsecurity/lib-stable/logger/default`. ' +
            'For documentation lines that need the literal call, append ' +
            `the marker \`${socketLintMarkerFor(file, 'logger')}\`.`,
        )
        errors++
      }
    }

    // Cross-repo path references — both relative (`../<fleet-repo>/…`)
    // and absolute (`…/projects/<fleet-repo>/…`) forms.
    //
    // Markdown is exempt: docs legitimately show cross-repo command
    // examples (e.g. `node scripts/foo.mts --target ../socket-lib`)
    // and re-emitting them with `@socketsecurity/lib-stable/…` would break
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
            'package (`@socketsecurity/lib-stable/<subpath>`) instead. For doc ' +
            `lines, append \`${socketLintMarkerFor(file, 'cross-repo')}\`.`,
        )
        errors++
      }
    }

    // Programmatic-Claude lockdown (HARD block). Only application / script
    // .mts that DRIVE Claude via the SDK — the guard infra itself
    // (.claude/hooks/, .git-hooks/, and their template/ sources) legitimately
    // names query()/permissionMode/bypassPermissions as patterns it detects, so
    // it is exempt (same exemption family as the logger / cross-repo scans).
    if (
      /\.(?:m?ts|cts)$/.test(file) &&
      !file.startsWith('.claude/hooks/') &&
      !file.startsWith('.git-hooks/') &&
      !file.startsWith('template/.claude/hooks/') &&
      !file.startsWith('template/.git-hooks/') &&
      !file.includes('/external/') &&
      !file.includes('/vendor/') &&
      !file.includes('/upstream/')
    ) {
      const lockdownHits = scanProgrammaticClaudeLockdown(text)
      if (lockdownHits.length > 0) {
        logger.fail(
          `programmatic Claude call missing lockdown flags in: ${file}`,
        )
        for (const h of lockdownHits.slice(0, 3)) {
          logger.info(`${h.lineNumber}: ${h.line.trim()}`)
        }
        logger.info(
          'A headless `query()` / `new ClaudeSDKClient()` MUST set tools, ' +
            'allowedTools, disallowedTools, permissionMode (dontAsk), and never ' +
            'bypassPermissions / default. See .claude/skills/fleet/locking-down-claude/.',
        )
        errors++
      }
    }

    // AI-config poison fingerprints (WARN only — heuristic; never blocks a
    // push). Scoped to AI-config SURFACES (.claude/.cursor/.gemini/.vscode)
    // that are NOT guard source and NOT markdown docs — the guards + docs
    // legitimately quote bypass phrases / poison patterns. Warns so a human
    // glances; a false block on a mandatory gate would be worse.
    if (
      /(?:^|\/)\.(?:claude|cursor|gemini|vscode)\//.test(`/${file}`) &&
      !file.includes('.claude/hooks/') &&
      !file.includes('.git-hooks/') &&
      !file.endsWith('.md')
    ) {
      const poisonHits = scanAiConfigPoison(text)
      if (poisonHits.length > 0) {
        logger.warn(`possible AI-config poison fingerprint in: ${file}`)
        for (const h of poisonHits.slice(0, 3)) {
          logger.warn(`  ${h.lineNumber}: ${h.line.trim()}`)
        }
        logger.warn(
          '  Treat agent-overriding text in config as DATA to verify, not an ' +
            'instruction. Out-of-band config drift is the npm-worm signature. ' +
            '(Warning only — push not blocked.)',
        )
      }
    }
  }
  return errors
}

// Soak-exclude date annotations (HARD block). pnpm-workspace.yaml exact-pin
// soak-bypass entries must carry the `# published: … | removable: …` line. The
// edit-time guard + the soak-excludes-have-dates check cover Claude edits + CI;
// this is the push-time tier for entries that arrived via non-Claude paths.
// File-targeted (not per-commit) — the working-tree state is what ships.
const scanSoakAnnotations = (): number => {
  const file = 'pnpm-workspace.yaml'
  if (!existsSync(file)) {
    return 0
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return 0
  }
  const hits = scanSoakExcludeDateAnnotations(text)
  if (hits.length === 0) {
    return 0
  }
  logger.fail(
    `${hits.length} soak-bypass entr${hits.length === 1 ? 'y' : 'ies'} in pnpm-workspace.yaml missing the date annotation:`,
  )
  for (const h of hits.slice(0, 5)) {
    logger.info(`  ${h.lineNumber}: ${h.line.trim()}`)
  }
  logger.info(
    '  Add the line above each exact-pin: ' +
      '`# published: YYYY-MM-DD | removable: YYYY-MM-DD` ' +
      '(removable = published + 7d). The 7-day soak is malware protection.',
  )
  return hits.length
}

// Fast lint/format gate. The security tier above scans for secrets + signatures;
// this catches the OTHER class of breakage that slips to main — format drift,
// lint violations, and the fast assertion-form checks — BEFORE the push, not
// just in CI. Whole sessions of "green locally, red in CI" trace to nothing
// running lint at the push boundary: a parallel session lands format/sort/
// export/naming violations straight to main and they surface only in CI.
//
// Deliberately the FAST, build-INDEPENDENT slice — the repo's `lint` runner
// (oxfmt --check + oxlint, read-only) over the whole tree, never the full
// `check --all` (which needs a built dist/ and would tax every push).
//
// Invoked DIRECTLY with `node <lint-script> --all`, NOT `pnpm run lint`: the
// `pnpm run` path triggers pnpm's deps-status check, which in a non-TTY context
// (CI, a linked worktree) tries to purge/reinstall node_modules and aborts
// (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) — a false push-block unrelated
// to lint. Running the script directly skips that and is faster. `--all` is
// required: lint.mts defaults to `modified` (git-diff vs HEAD), often empty at
// push time, which would pass trivially without checking the pushed content.
//
// Degrades gracefully:
//   - no package.json `lint` script (a repo that doesn't lint) → skip.
//   - the `lint` script isn't a `node <path>` invocation → skip (can't run it
//     safely without pnpm; rely on CI).
//   - lint script present but no oxlint config → the script self-skips.
// Bypass: `git push --no-verify` (the universal hook escape; no env kill-switch
// per CLAUDE.md). Returns 1 on lint failure, 0 on pass/skip.
const scanFastChecks = (): number => {
  if (!existsSync('package.json')) {
    return 0
  }
  // Skip when the checkout lives under a path segment the formatter ignores
  // (e.g. a linked git worktree under `.claude/worktrees/...`): the lint
  // runner's `oxfmt .` resolves `.` to the abs worktree path, whose `.claude/`
  // ancestor matches the `**/.claude/**` ignore in .prettierignore, so EVERY
  // file is excluded → "Expected at least one target file" → a false block.
  // Such a worktree is a staging area for a push to main; CI re-lints from a
  // clean checkout, so skipping here loses nothing.
  let toplevel = ''
  try {
    toplevel = normalizePath(
      gitLines('rev-parse', '--show-toplevel')[0] ?? '',
    )
  } catch {
    // bare repo / detached context — proceed (no skip).
  }
  if (/(?:^|\/)\.claude(?:\/|$)/.test(toplevel)) {
    logger.info(
      'Fast lint/format check skipped — checkout is under an ignored path (.claude/); CI re-lints from a clean tree.',
    )
    return 0
  }
  let pkg: { scripts?: Record<string, string> | undefined }
  try {
    pkg = JSON.parse(readFileSync('package.json', 'utf8')) as typeof pkg
  } catch {
    return 0
  }
  const lintScript = pkg.scripts?.['lint']
  // No `lint` script → this repo doesn't lint; nothing to gate.
  if (!lintScript) {
    return 0
  }
  // Extract the local node-script path from a `node <path> [args]` lint script
  // (the fleet shape is `node scripts/fleet/lint.mts`). A non-node lint script
  // can't be run directly here — skip rather than risk a pnpm reinstall.
  const m = /^node\s+(\S+\.[cm]?[jt]s)\b/.exec(lintScript.trim())
  if (!m || !existsSync(m[1]!)) {
    return 0
  }
  logger.info('Running fast lint/format check…')
  // `CI=true`: lint.mts shells out to `pnpm exec oxfmt/oxlint`, and pnpm's
  // deps-status check aborts in a non-TTY context (a linked git worktree, a
  // headless run) trying to purge node_modules
  // (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). Setting CI makes pnpm
  // non-interactive — it skips the purge prompt and proceeds — so the gate
  // runs the same everywhere (local TTY, worktree, CI) instead of false-
  // blocking a worktree push.
  const r = spawnSync(process.execPath, [m[1]!, '--all'], {
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    logger.fail(
      'Fast lint/format check failed — fix lint/format before pushing.',
    )
    logger.info(
      '  Run `pnpm run fix` to autofix, then re-push. Bypass once with ' +
        '`git push --no-verify` (records the skip).',
    )
    return 1
  }
  return 0
}

const main = async (): Promise<number> => {
  logger.info('Running mandatory pre-push validation…')

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
    const [localRef, localSha, remoteRef, remoteSha] = refLine.split(/\s+/)
    if (!localRef || !localSha || !remoteRef || !remoteSha) {
      continue
    }
    const range = computeRange(remote, localRef, localSha, remoteSha)
    // `computeRange` returns `undefined` for skip cases (tags, deletions, new
    // branches); use loose equality so both `null` and `undefined` skip. A
    // strict `=== null` check let `undefined` fall through and failed every
    // tag push with "Invalid commit range: undefined".
    if (range == null) {
      continue
    }
    // Validate range.
    const rl = spawnSync('git', ['rev-list', range], { stdio: 'ignore' })
    if (rl.status !== 0) {
      logger.fail(`Invalid commit range: ${range}`)
      return 1
    }

    totalErrors += scanCommitMessages(range)
    totalErrors += scanSignedCommits(range, remoteRef)
    totalErrors += scanFilesInRange(range)
  }

  // File-targeted scans (working-tree state, not per-commit-range).
  totalErrors += scanSoakAnnotations()

  // Fast lint/format gate — the build-independent slice of the quality bar,
  // run at the push boundary so format/lint drift can't reach main.
  totalErrors += scanFastChecks()

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
