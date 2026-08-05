// Pre-push per-file content gate. Scans every file changed in the range for
// secrets, credentials, personal paths, logger leaks, cross-repo references,
// programmatic-Claude lockdown violations, and AI-config poison fingerprints.

import { existsSync, statSync } from 'node:fs'

import path from 'node:path'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { readFileForScan, shouldSkipFile } from './file-scan.mts'
import { gitLines } from './git.mts'
import { socketLintMarkerFor, stripTemplateLayer } from './scan-core.mts'
import { scanCrossRepoPaths, scanLoggerLeaks } from './scan-code-refs.mts'
import {
  scanAwsKeys,
  scanGitHubTokens,
  scanPersonalPaths,
  scanPrivateKeys,
  scanSocketApiKeys,
} from './scan-secrets.mts'
import {
  scanAiConfigPoison,
  scanProgrammaticClaudeLockdown,
} from './scan-supply-chain.mts'

const logger = getDefaultLogger()

// Scans changed files in the range for secrets, keys, and leaks.
export const scanFilesInRange = (range: string): number => {
  logger.info('Checking files for security issues…')
  // Normalize to POSIX forward slashes — same reason as pre-commit.mts.
  const changed = gitLines('diff', '--name-only', range).map(normalizePath)
  let errors = 0
  if (changed.length === 0) {
    return 0
  }

  // .env files at any depth — match commit-msg.mts and pre-commit.mts.
  // Allow .env.example, .env.test, .env.precommit (templates / tracked
  // placeholders); block bare .env / .env.local / .env.production /
  // anything else regardless of directory depth.
  const envHits = changed.filter(f => {
    const base = path.basename(f)
    return (
      /^\.env(?:\.[^/]+)?$/.test(base) &&
      !/^\.env\.(?:example|precommit|test)$/.test(base)
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
  for (let k = 0, { length: klen } = changed; k < klen; k += 1) {
    const file = changed[k]!
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

    // Layer-agnostic form of the path for the `template/...` exemptions: the
    // archetype move buries the canonical sources under template/<layer>/, so
    // the prefix exemptions test this collapsed form (template/base/.git-hooks/x
    // → template/.git-hooks/x) instead of the raw moved path.
    const layerless = stripTemplateLayer(file)

    const pathHits = scanPersonalPaths(text)
    if (pathHits.length > 0) {
      logger.fail(`Hardcoded personal path found in: ${file}`)
      const hItems2 = pathHits.slice(0, 3)
      for (let i = 0, { length } = hItems2; i < length; i += 1) {
        const h = hItems2[i]!
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
          'literal form, put the marker ' +
          `\`${socketLintMarkerFor(file, 'personal-path')}\` on its own line above it.`,
      )
      errors++
    }

    const apiHits = scanSocketApiKeys(text)
    if (apiHits.length > 0) {
      logger.fail(`Real API key detected in: ${file}`)
      const topApiHits = apiHits.slice(0, 3)
      for (let i = 0, { length } = topApiHits; i < length; i += 1) {
        const h = topApiHits[i]!
        logger.info(`${h.lineNumber}:${h.line.trim()}`)
      }
      errors++
    }

    const awsHits = scanAwsKeys(text)
    if (awsHits.length > 0) {
      logger.fail(`Potential AWS credentials found in: ${file}`)
      const topAwsHits = awsHits.slice(0, 3)
      for (let i = 0, { length } = topAwsHits; i < length; i += 1) {
        const h = topAwsHits[i]!
        logger.info(`${h.lineNumber}:${h.line.trim()}`)
      }
      errors++
    }

    const ghHits = scanGitHubTokens(text)
    if (ghHits.length > 0) {
      logger.fail(`Potential GitHub token found in: ${file}`)
      const topGhHits = ghHits.slice(0, 3)
      for (let i = 0, { length } = topGhHits; i < length; i += 1) {
        const h = topGhHits[i]!
        logger.info(`${h.lineNumber}:${h.line.trim()}`)
      }
      errors++
    }

    // Conformance test vectors (`conformance/{vectors,cases,fixtures}/…`) hold
    // deterministic golden crypto data — a `-----BEGIN … PRIVATE KEY-----` block
    // there is a checked-in test vector for a crypto lib's decrypt conformance
    // (e.g. envrypt), never a live secret. Exempt only these test-data dirs.
    const isConformanceVector =
      /(?:^|\/)conformance\/(?:cases|fixtures|vectors)\//.test(
        normalizePath(file),
      )
    const pkHits = isConformanceVector ? [] : scanPrivateKeys(text)
    if (pkHits.length > 0) {
      logger.fail(`Private key found in: ${file}`)
      errors++
    }

    if (
      !file.startsWith('.claude/hooks/') &&
      !file.startsWith('.git-hooks/') &&
      !file.startsWith('scripts/') &&
      // The dep-0 bootstrap runs before any dependency exists, so it never
      // imports socket-lib's logger and must call console.* directly. Its live
      // home, scripts/repo/bootstrap/, is covered by the scripts/ exemption;
      // this covers the LEGACY root copies until the fleet sweep lands.
      !file.startsWith('bootstrap/') &&
      // template/ holds the canonical sources that cascade to
      // .claude/hooks/, .git-hooks/, and scripts/ in downstream
      // fleet repos. The same exemption that applies at the
      // destination has to apply at the source; otherwise wheelhouse
      // template edits get flagged for code that's intentionally raw
      // where it actually runs. `layerless` collapses the archetype
      // layer segment so the move (template/base/...) stays exempt.
      !layerless.startsWith('template/.claude/hooks/') &&
      !layerless.startsWith('template/.git-hooks/') &&
      !layerless.startsWith('template/scripts/') &&
      !normalizePath(file).includes('/external/') &&
      !normalizePath(file).includes('/vendor/') &&
      !normalizePath(file).includes('/upstream/') &&
      // src/logger/ IS the logger — implementing the surface itself
      // requires direct console.* calls.
      !file.startsWith('src/logger/') &&
      // Matches TypeScript source extensions: .mts, .ts, .tsx, .cts — the only file types that can log.
      /\.(?:cts|m?ts|tsx)$/.test(file)
    ) {
      const loggerHits = scanLoggerLeaks(text)
      if (loggerHits.length > 0) {
        logger.fail(`direct stream write found in: ${file}`)
        const hItems2 = loggerHits.slice(0, 3)
        for (let j = 0, { length: jlen } = hItems2; j < jlen; j += 1) {
          const h = hItems2[j]!
          logger.info(`${h.lineNumber}: ${h.line.trim()}`)
          if (h.suggested && h.suggested !== h.line) {
            logger.info(`     fix: ${h.suggested.trim()}`)
          }
        }
        logger.info(
          'Use `getDefaultLogger()` from `@socketsecurity/lib-stable/logger/default`. ' +
            'For a deliberate raw write, put the marker on its own line above ' +
            'the call: `// socket-lint: allow console` for `console.*`, or ' +
            '`// socket-lint: allow process-stdio` for `process.std{out,err}.write` ' +
            '(the id must match the call kind — that is what `scanLoggerLeaks` keys on). ' +
            'no-malformed-bypass-marker rejects the trailing form.',
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
      !normalizePath(file).includes('/external/') &&
      !normalizePath(file).includes('/vendor/') &&
      !normalizePath(file).includes('/upstream/') &&
      file !== 'pnpm-lock.yaml' &&
      file !== 'pnpm-workspace.yaml'
    ) {
      const crossRepoHits = scanCrossRepoPaths(text, path.resolve(file))
      if (crossRepoHits.length > 0) {
        logger.fail(`cross-repo path reference in: ${file}`)
        const hItems2 = crossRepoHits.slice(0, 3)
        for (let i = 0, { length } = hItems2; i < length; i += 1) {
          const h = hItems2[i]!
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
      /\.(?:cts|m?ts)$/.test(file) &&
      !file.startsWith('.claude/hooks/') &&
      !file.startsWith('.git-hooks/') &&
      !layerless.startsWith('template/.claude/hooks/') &&
      !layerless.startsWith('template/.git-hooks/') &&
      !normalizePath(file).includes('/external/') &&
      !normalizePath(file).includes('/vendor/') &&
      !normalizePath(file).includes('/upstream/')
    ) {
      const lockdownHits = scanProgrammaticClaudeLockdown(text)
      if (lockdownHits.length > 0) {
        logger.fail(
          `programmatic Claude call missing lockdown flags in: ${file}`,
        )
        const hItems = lockdownHits.slice(0, 3)
        for (let i = 0, { length } = hItems; i < length; i += 1) {
          const h = hItems[i]!
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
        const hList = poisonHits.slice(0, 3)
        for (let i = 0, { length } = hList; i < length; i += 1) {
          const h = hList[i]!
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
