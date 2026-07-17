#!/usr/bin/env node
// Claude Code PreToolUse hook — prefer-async-spawn-guard.
//
// Blocks Edit/Write tool calls that import from `node:child_process`
// (or bare `child_process`). The fleet routes every subprocess through
// `@socketsecurity/lib-stable/process/spawn/child`:
//
//   - async `spawn` over `spawnSync` (sync freezes the runner),
//   - a typed `SpawnError` + `isSpawnError` guard,
//   - an array-of-args contract that avoids `execSync`'s shell-injection
//     surface.
//
// Mirrors the commit-time `socket/prefer-async-spawn` +
// `socket/prefer-spawn-over-execsync` oxlint rules, catching the import at
// edit time so the agent never writes the wrong shape (the original
// incident: a script imported `{ spawnSync } from 'node:child_process'`,
// which the lint rule would only have caught at commit).
//
// Reads a Claude Code PreToolUse JSON payload:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Fails open on malformed payloads.
//
// Bypass (per call): user types `Allow async-spawn bypass`.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { isRepoTestHome } from '../_shared/repo-test-home.mts'

const logger = getDefaultLogger()

interface Finding {
  readonly line: number
  readonly text: string
}

const BYPASS_PHRASE = 'Allow async-spawn bypass'

// `import ... from 'node:child_process'` / `'child_process'` (static import
// or re-export), and `require('node:child_process')`. Quote style and the
// `node:` prefix both tolerated. Matched per-line.
const CHILD_PROCESS_IMPORT_RE =
  /\b(?:import|export)\b[^\n]*\bfrom\s*['"](?:node:)?child_process['"]/
const CHILD_PROCESS_REQUIRE_RE =
  /\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)/

/**
 * Files where importing `node:child_process` is legitimate: this hook's own
 * files, the oxlint rules that match the banned shapes, the markdownlint
 * self-skip shim (a `.mjs` rule loaded by markdownlint-cli2, which can't await
 * the async lib wrapper, so its documented fallback is the sync builtin), and
 * the pre-pnpm bootstrap `.mjs` provisioners under `scripts/fleet/setup/`.
 * Those install pnpm itself on a bare machine BEFORE node_modules exists, so
 * `@socketsecurity/lib`'s async `spawn` wrapper isn't on disk to import — the
 * sync builtin is the only option (same constraint as the markdownlint shim);
 * each carries an `oxlint-disable socket/prefer-async-spawn` documenting it.
 */
export function isExemptPath(filePath: string): boolean {
  const normalizedFilePath = normalizePath(filePath)
  return (
    normalizedFilePath.includes('/_internal/') ||
    normalizedFilePath.includes('/dist/') ||
    normalizedFilePath.includes('/build/') ||
    normalizedFilePath.includes('/node_modules/') ||
    normalizedFilePath.includes(
      '/.claude/hooks/fleet/prefer-async-spawn-guard/',
    ) ||
    // The two spawn rules live at .config/fleet/oxlint-plugin/fleet/<id>/ (index.mts +
    // test/), embedding the banned execSync/spawnSync shape as rule data; the
    // per-rule dir prefix exempts both files at once.
    normalizedFilePath.includes(
      '/.config/fleet/oxlint-plugin/fleet/prefer-async-spawn/',
    ) ||
    normalizedFilePath.includes(
      '/.config/fleet/oxlint-plugin/fleet/prefer-spawn-over-execsync/',
    ) ||
    normalizedFilePath.includes(
      '/.config/fleet/markdownlint-rules/_shared/wheelhouse-self-skip.',
    ) ||
    // Pre-pnpm bootstrap .mjs provisioners (scripts/fleet/setup/{lib/,*}.mjs):
    // run before node_modules exists, so the lib spawn wrapper isn't importable
    // yet. Scoped to `.mjs` so the dir's `.mts` steps stay guarded.
    (normalizedFilePath.includes('/scripts/fleet/setup/') &&
      normalizedFilePath.endsWith('.mjs')) ||
    // The dep-0 bootstrap (bootstrap/fleet.mjs, bootstrap/prepare.mts) is the
    // fetcher that runs before any dependency exists — same constraint as the
    // setup provisioners above, so the sync builtin is its only spawn option.
    /(?:^|\/)bootstrap\//.test(normalizedFilePath) ||
    isRepoTestHome(filePath)
  )
}

export function findChildProcessImports(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (
      CHILD_PROCESS_IMPORT_RE.test(line) ||
      CHILD_PROCESS_REQUIRE_RE.test(line)
    ) {
      findings.push({ line: i + 1, text: line.trim() })
    }
  }
  return findings
}

export const check = editGuard(
  (filePath, content, payload) => {
    if (isExemptPath(filePath)) {
      return undefined
    }
    // Only police JS/TS source.
    if (!/\.(?:c|m)?[jt]sx?$/.test(filePath)) {
      return undefined
    }

    const text = content ?? ''
    if (!text) {
      return undefined
    }

    const findings = findChildProcessImports(text)
    if (findings.length === 0) {
      return undefined
    }

    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      logger.error(
        `prefer-async-spawn-guard: ${findings.length} child_process import(s) — bypassed via "${BYPASS_PHRASE}"`,
      )
      logger.error('')
      return undefined
    }

    const lines = findings
      .map(f => `  ${filePath}:${f.line}  ${f.text}`)
      .join('\n')
    return block(
      `prefer-async-spawn-guard: refusing to import from 'node:child_process'.\n` +
        `\n${lines}\n\n` +
        `Use the fleet wrapper instead:\n` +
        `  import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'\n` +
        `Prefer async \`spawn\`; reach for \`spawnSync\` only when sync semantics\n` +
        `are genuinely required (still from the lib, not the builtin). This holds\n` +
        `for the LIB spawnSync too — async where the caller can await (subprocess-\n` +
        `heavy pnpm/npm/git-network calls especially; sync for CLI bootstrap / hot\n` +
        `loops only, code-style.md). windows-portability flags pnpm-family spawns\n` +
        `missing \`shell: WIN32\`.\n` +
        `Bypass: type "${BYPASS_PHRASE}".\n`,
    )
  },
  { fleetOnly: true },
)

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
