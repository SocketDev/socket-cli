#!/usr/bin/env node
// Claude Code PreToolUse hook — vitest-vs-node-test-guard.
//
// Catches files that import `node:test` while sitting at a path the repo's
// `vitest.config.*` would pick up via its `include` glob. Mismatched runners
// produce confusing "No test suite found in file" errors because vitest
// loads the file, finds no `describe`/`it`/`test` registration (the file
// uses node:test's API instead), and bails.
//
// Detection model:
//   - Fires on Write/Edit operations whose target file path imports
//     `node:test`.
//   - Reads the repo's `vitest.config.*` from the standard fleet locations
//     (`.config/repo/vitest.config.mts`, `vitest.config.mts/mjs/ts/js`, or the
//     `template/.config/` mirror for wheelhouse).
//   - Parses the config's `include` globs (string-literal extraction; if
//     the config uses dynamic globs, we fail open).
//   - Matches the target file path against each glob via a minimatch-style
//     comparison. If a match is found, block.
//
// Bypass: `Allow node-test-in-vitest-include bypass` typed verbatim in a
// recent user turn. Or add the file path to vitest's `exclude` glob in
// `vitest.config.*` (the long-term fix).
//
// Fails open on parse / config-not-found errors — under-blocking is better
// than blocking on infrastructure problems.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow node-test-in-vitest-include bypass'

// Standard fleet vitest config locations, checked in order. `.mts` is the
// fleet's default extension, so every `.config/`-rooted location lists it
// first (the older `.mjs`/`.ts`/`.js` forms follow for non-fleet repos).
const VITEST_CONFIG_CANDIDATES = [
  '.config/repo/vitest.config.mts',
  '.config/vitest.config.mts',
  '.config/vitest.config.mjs',
  '.config/vitest.config.ts',
  '.config/vitest.config.js',
  'vitest.config.mts',
  'vitest.config.mjs',
  'vitest.config.ts',
  'vitest.config.js',
  'template/.config/vitest.config.mts',
  'template/.config/vitest.config.mjs',
  'template/vitest.config.mts',
]

// Extract `include: [...]` string-literal entries from a vitest config.
// Permissive parse — we look for the literal pattern `include: [...]` (or
// `include:[...]`) and pull every quoted string out of the matched bracket
// body. If the config uses dynamic globs (variable references, spreads,
// or function calls), we return undefined and fail open.
export function extractIncludeGlobs(configText: string): string[] | undefined {
  const m = /include\s*:\s*\[([^\]]*)\]/.exec(configText)
  if (!m) {
    return undefined
  }
  const body = m[1]!
  // Bail if the body has anything that isn't a string literal, comma, or
  // whitespace.
  if (/[^\s,'"`\w./*[\]{}-]/.test(body)) {
    // contains identifiers / spreads / function calls / etc.
    // Allow comma + whitespace + glob chars; bail on anything else.
  }
  const globs: string[] = []
  const stringRe = /(['"`])((?:\\.|(?!\1).)*?)\1/g
  let strM: RegExpExecArray | null
  while ((strM = stringRe.exec(body)) !== null) {
    globs.push(strM[2]!)
  }
  if (globs.length === 0) {
    return undefined
  }
  return globs
}

export function fileImportsNodeTest(text: string): boolean {
  // Detect `import test from 'node:test'`, `import { test } from 'node:test'`,
  // or `from "node:test"`. Conservative; ignores `from 'node:test/...'`.
  return /from\s+['"`]node:test['"`]/.test(text)
}

export function findVitestConfig(startDir: string): string | undefined {
  let cur = startDir
  for (let depth = 0; depth < 10; depth += 1) {
    for (let i = 0, { length } = VITEST_CONFIG_CANDIDATES; i < length; i += 1) {
      const rel = VITEST_CONFIG_CANDIDATES[i]!
      const p = path.join(cur, rel)
      if (existsSync(p)) {
        return p
      }
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  return undefined
}

// Convert a vitest-style glob to a regex. Supports `**`, `*`, `?`, and
// brace alternation `{a,b}`. Not a full minimatch — covers the patterns
// actually seen in fleet vitest configs.
export function globToRegex(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i += 1
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      const close = glob.indexOf('}', i)
      if (close < 0) {
        re += '\\{'
      } else {
        const alts = glob
          .slice(i + 1, close)
          .split(',')
          .map(a => globToRegexBody(a))
          .join('|')
        re += `(?:${alts})`
        i = close
      }
    } else if (/[.+^$()|\\]/.test(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp('^' + re + '$')
}

export function globToRegexBody(glob: string): string {
  // Lightweight inner conversion used inside brace alternation; reuses
  // globToRegex's main loop but returns just the body. To keep the code
  // small, we run the main converter and strip the anchors.
  const r = globToRegex(glob).source
  return r.replace(/^\^/, '').replace(/\$$/, '')
}

export function relPathFromRepoRoot(
  filePath: string,
  configPath: string,
): string {
  // configPath is `<repo>/.config/vitest.config.mts` or
  // `<repo>/vitest.config.mts` etc. — strip the trailing config dir to get
  // the repo root.
  let repoRoot = path.dirname(configPath)
  if (repoRoot.endsWith('/.config') || repoRoot.endsWith('/template/.config')) {
    repoRoot = path.dirname(repoRoot)
  }
  if (repoRoot.endsWith('/template')) {
    repoRoot = path.dirname(repoRoot)
  }
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// content extraction (new_string / content), and fail-open on any throw.
await withEditGuard((filePath, content, payload) => {
  if (!/\.(cjs|cts|js|mjs|mts|ts)$/.test(filePath)) {
    return
  }

  // Determine the after-content.
  let afterText = ''
  if (payload.tool_name === 'Write') {
    afterText = content ?? ''
  } else {
    // For Edit: the new_string is enough to check the import shape; if it
    // doesn't reference node:test in the diff, also check the current file
    // (in case the import was already there and the edit only touches body).
    afterText = content ?? ''
    if (!fileImportsNodeTest(afterText) && existsSync(filePath)) {
      try {
        afterText = readFileSync(filePath, 'utf8')
      } catch {
        return
      }
    }
  }
  if (!fileImportsNodeTest(afterText)) {
    return
  }

  const configPath = findVitestConfig(payload.cwd ?? path.dirname(filePath))
  if (!configPath) {
    return
  }
  let configText: string
  try {
    configText = readFileSync(configPath, 'utf8')
  } catch {
    return
  }
  const globs = extractIncludeGlobs(configText)
  if (!globs || globs.length === 0) {
    return
  }

  const relPath = relPathFromRepoRoot(filePath, configPath)
  const matched: string[] = []
  for (let i = 0, { length } = globs; i < length; i += 1) {
    const glob = globs[i]!
    try {
      const re = globToRegex(glob)
      if (re.test(relPath)) {
        matched.push(glob)
      }
    } catch {
      // Skip broken globs.
    }
  }
  if (matched.length === 0) {
    return
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return
  }

  logger.error(
    [
      '[vitest-vs-node-test-guard] Blocked: node:test file under vitest include',
      '',
      `  File:           ${filePath}`,
      `  Rel:            ${relPath}`,
      `  Vitest config:  ${configPath}`,
      `  Matching globs: ${matched.map(g => `\`${g}\``).join(', ')}`,
      '',
      "  The file imports `node:test` but its path matches one of vitest's",
      '  `include` globs. Vitest will try to load it, see no describe/it/test',
      '  registration, and emit "No test suite found in file."',
      '',
      '  Fix:',
      "    - Add the file path (or its parent directory) to vitest's",
      '      `exclude` array in the vitest config, OR',
      "    - Convert the file to vitest's API (replace `node:test` imports",
      '      with `vitest` describe/it/test).',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
