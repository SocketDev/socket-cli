#!/usr/bin/env node
// Claude Code PreToolUse hook — uses-sha-verify-guard.
//
// Every GitHub URL pin in fleet repos needs a full 40-char SHA that
// resolves in the referenced repo. Blocks Edit/Write/MultiEdit/Bash
// tool calls that introduce SHA pins that are:
//   1. Truncated (less than 40 hex chars for commit SHAs; less than
//      64 hex chars for content-hash sha256: pins).
//   2. Not actually hex (version tags like `v1.2.3`, branch names
//      like `main`, partial SHAs).
//   3. Real-length but not reachable in the referenced repo (via
//      `gh api repos/<owner>/<repo>/commits/<sha>`).
//   4. Missing from a `.gitmodules` submodule block (BOTH the
//      `# <name>-<version> sha256:<64hex>` comment AND the
//      `ref = <40hex>` field are required).
//
// Four surfaces:
//
// A. `.github/workflows/*.yml` + `.github/actions/*/action.yml`:
//    Every `uses: <owner>/<repo>(?:/<path>)?@<ref>` must have a full
//    40-char hex `<ref>` that resolves.
//
// B. `.gitmodules` at the repo root:
//    Every `[submodule "..."]` block MUST carry BOTH a
//    `# <name>-<version> sha256:<64hex>` header comment AND a
//    `ref = <40hex>` field — and refSha must resolve in the
//    submodule's GitHub url.
//
// C. `package.json`:
//    Every `git+https://github.com/<owner>/<repo>(?:\.git)?#<ref>`
//    dep specifier in `dependencies`, `devDependencies`,
//    `peerDependencies`, `optionalDependencies`, `overrides`, or
//    `resolutions` must have a full 40-char hex `<ref>`.
//
// D. Bash commands targeting any of the above paths via sed/awk/echo:
//    Catches the shell-out path that bypassed the Edit/Write gate
//    during the v6.0.7 publish miss (see commit d6483ba4).
//
// Companion to `gitmodules-comment-guard` (which enforces the
// `# <name>-<version>` shape but not SHA validity). Caching via
// `~/.claude/uses-sha-verify-cache.json` keyed by `<repo>@<sha>`
// with a 7-day TTL.
//
// Bypass: `Allow uses-sha-verify bypass`.

import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import {
  readCommand,
  readFilePath,
  readWriteContent,
} from '../_shared/payload.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

import { findBareUsesIssues, findLoneShaIssues } from './lib/bash.mts'
import { loadCache, saveCache } from './lib/cache.mts'
import { findGitmodulesIssues } from './lib/gitmodules.mts'
import { findPackageJsonIssues } from './lib/package-json.mts'
import { BASH_TARGETS_WORKFLOW_RE } from './lib/regexes.mts'
import { findUsesIssues } from './lib/workflow.mts'

const BYPASS_PHRASE = 'Allow uses-sha-verify bypass'

function isWorkflowOrActionPath(filePath: string): boolean {
  return (
    /\.github\/workflows\/[^/]+\.ya?ml$/.test(filePath) ||
    /\.github\/actions\/[^/]+\/action\.ya?ml$/.test(filePath)
  )
}

function isGitmodulesPath(filePath: string): boolean {
  return filePath.endsWith('/.gitmodules') || filePath === '.gitmodules'
}

function isPackageJsonPath(filePath: string): boolean {
  if (filePath.includes('/node_modules/')) {
    return false
  }
  return filePath.endsWith('/package.json') || filePath === 'package.json'
}

function checkBashSurface(
  command: string,
  payload: ToolCallPayload,
): GuardResult {
  if (!BASH_TARGETS_WORKFLOW_RE.test(command)) {
    return undefined
  }
  const cache = loadCache()
  const bareResult = findBareUsesIssues(command, cache)
  const loneIssues = findLoneShaIssues(command, cache, bareResult.scannedShas)
  saveCache(cache)
  const issues = [...bareResult.issues, ...loneIssues]
  if (issues.length === 0) {
    return undefined
  }
  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }
  const out: string[] = [
    'uses-sha-verify-guard: SHA pin verification failed (Bash surface)',
    '',
    '  Command targets a workflow / action / .gitmodules file but the',
    '  SHA reference(s) are malformed or unreachable:',
    '',
  ]
  for (let i = 0, { length } = issues; i < length; i += 1) {
    const issue = issues[i]!
    out.push(`  ${issue.raw}`)
    out.push(`    ↳ ${issue.problem}`)
    out.push('')
  }
  out.push(`  Bypass: "${BYPASS_PHRASE}" in a recent user message.`)
  return block(out.join('\n'))
}

function checkEditWriteSurface(
  filePath: string,
  body: string | undefined,
  payload: ToolCallPayload,
): GuardResult {
  const isUses = isWorkflowOrActionPath(filePath)
  const isGitmodules = isGitmodulesPath(filePath)
  const isPackageJson = isPackageJsonPath(filePath)
  if (!isUses && !isGitmodules && !isPackageJson) {
    return undefined
  }

  if (!body) {
    return undefined
  }

  const cache = loadCache()
  const usesIssues = isUses ? findUsesIssues(body, cache) : []
  const gitmodulesIssues = isGitmodules ? findGitmodulesIssues(body, cache) : []
  const packageJsonIssues = isPackageJson
    ? findPackageJsonIssues(body, cache)
    : []
  saveCache(cache)

  if (
    usesIssues.length === 0 &&
    gitmodulesIssues.length === 0 &&
    packageJsonIssues.length === 0
  ) {
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  const out: string[] = [
    'uses-sha-verify-guard: SHA pin verification failed',
    '',
  ]
  for (const issue of usesIssues) {
    out.push(`  ${filePath}:${issue.line}`)
    out.push(`    ${issue.raw}`)
    out.push(`    ↳ ${issue.problem}`)
    out.push('')
  }
  for (const issue of gitmodulesIssues) {
    out.push(`  ${filePath}:${issue.line} [submodule "${issue.submodule}"]`)
    out.push(`    ↳ ${issue.problem}`)
    out.push('')
  }
  for (const issue of packageJsonIssues) {
    out.push(
      `  ${filePath}: git+https://github.com/${issue.ownerRepo}#${issue.ref}`,
    )
    out.push(`    ↳ ${issue.problem}`)
    out.push('')
  }
  out.push('Fix the pin(s) above, or bypass with the canonical phrase:')
  out.push(`  ${BYPASS_PHRASE}`)
  return block(out.join('\n'))
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const toolName = payload.tool_name
  if (toolName === 'Bash') {
    const command = readCommand(payload)
    if (!command) {
      return undefined
    }
    return checkBashSurface(command, payload)
  }
  if (toolName !== 'Edit' && toolName !== 'MultiEdit' && toolName !== 'Write') {
    return undefined
  }
  const filePath = readFilePath(payload)
  if (!filePath) {
    return undefined
  }
  return checkEditWriteSurface(filePath, readWriteContent(payload), payload)
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
