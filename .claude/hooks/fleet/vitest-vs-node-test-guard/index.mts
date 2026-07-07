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

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { isRepoTestHome } from '../_shared/repo-test-home.mts'

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
  'template/base/.config/repo/vitest.config.mts',
  'template/base/.config/vitest.config.mts',
  'template/base/.config/vitest.config.mjs',
  'template/base/vitest.config.mts',
]

// Extract `include: [...]` string-literal entries from a vitest config.
// Permissive parse — we look for the literal pattern `include: [...]` (or
// `include:[...]`) and pull every quoted string out of the matched bracket
// body. If the config uses dynamic globs (variable references, spreads,
// or function calls), we return undefined and fail open.
export function extractIncludeGlobs(configText: string): string[] | undefined {
  const m = /include\s*:\s*\[(?<body>[^\]]*)\]/.exec(configText)
  if (!m) {
    return undefined
  }
  const body = m.groups!.body!
  // Bail if the body has anything that isn't a string literal, comma, or
  // whitespace.
  if (/[^\s,'"`\w./*[\]{}-]/.test(body)) {
    // contains identifiers / spreads / function calls / etc.
    // Allow comma + whitespace + glob chars; bail on anything else.
  }
  const globs: string[] = []
  const stringRe = /(?<q>['"`])(?<glob>(?:\\.|(?!\k<q>).)*?)\k<q>/g
  let strM: RegExpExecArray | null
  while ((strM = stringRe.exec(body)) !== null) {
    globs.push(strM.groups!.glob!)
  }
  if (globs.length === 0) {
    return undefined
  }
  return globs
}

export function fileImportsNodeTest(text: string): boolean {
  // Detect a real `from 'node:test'` import (default, named, or double-quoted);
  // ignores `from 'node:test/...'`. Comments are stripped first so an
  // illustrative import inside a `//` or `/* */` comment — a config documenting
  // node:test exclusion, or this guard's own JSDoc — is never mistaken for a
  // real import. URL `//` (preceded by `:`) is preserved.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
  return /from\s+['"`]node:test['"`]/.test(code)
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
  // configPath is `<repo>/vitest.config.mts`, `<repo>/.config/vitest.config.mts`,
  // `<repo>/.config/repo/vitest.config.mts`, or the wheelhouse
  // `<repo>/template/base/.config/[repo/]vitest.config.mts` mirror. Strip the
  // matching trailing container directory back to the repo root. Try the known
  // wrapper suffixes longest-first so a repo whose own root dir happens to be
  // named `repo`/`template` isn't mis-stripped (only the full known chain
  // matches).
  let repoRoot = path.dirname(configPath)
  const WRAPPER_SUFFIXES = [
    '/template/base/.config/repo',
    '/template/base/.config',
    '/template/base',
    '/.config/repo',
    '/.config',
  ]
  for (let i = 0, { length } = WRAPPER_SUFFIXES; i < length; i += 1) {
    const suffix = WRAPPER_SUFFIXES[i]!
    if (repoRoot.endsWith(suffix)) {
      repoRoot = repoRoot.slice(0, -suffix.length)
      break
    }
  }
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

export const check = editGuard((filePath, content, payload) => {
  if (!/\.(cjs|cts|js|mjs|mts|ts)$/.test(filePath)) {
    return undefined
  }
  if (isRepoTestHome(filePath)) {
    return undefined
  }

  // Scan the full post-edit document (not just the new_string diff) so an edit
  // to the body of a file that already imports node:test is still caught.
  const afterText = resolveEditedText(payload)
  if (afterText === undefined || !fileImportsNodeTest(afterText)) {
    return undefined
  }

  const configPath = findVitestConfig(payload.cwd ?? path.dirname(filePath))
  if (!configPath) {
    return undefined
  }
  let configText: string
  try {
    configText = readFileSync(configPath, 'utf8')
  } catch {
    return undefined
  }
  const globs = extractIncludeGlobs(configText)
  if (!globs || globs.length === 0) {
    return undefined
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
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  return block(
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
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
