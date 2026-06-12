#!/usr/bin/env node
// Claude Code PreToolUse hook — no-other-linters-guard.
//
// The fleet uses oxlint + oxfmt ONLY. No ESLint, Prettier, Biome, dprint, or
// rome. This guard blocks introducing them at edit time, two ways:
//
//   1. Creating / editing a foreign linter/formatter CONFIG file:
//      biome.json(c), .eslintrc*, eslint.config.*, .prettierrc*,
//      prettier.config.*, .dprint.json* .
//   2. Adding a foreign linter/formatter PACKAGE to a package.json's
//      dependencies / devDependencies: @biomejs/biome, eslint, @eslint/*,
//      @typescript-eslint/*, prettier, dprint, rome (+ eslint-config-* /
//      eslint-plugin-* / @<scope>/eslint-*).
//
// Complements `socket/no-eslint-biome-config-ref` (which REPORTS stale string
// refs in TS/JS source) and `scripts/fleet/check/only-oxlint-oxfmt.mts` (which
// gates committed state). This is the edit-time block on the surfaces those miss
// — config files + package.json dep blocks.
//
// EXEMPT: vendored upstream trees (`upstream/`, `vendor/`, `third_party/`,
// `external/`, a package dir ending `-upstream`). We never touch upstream files;
// upstream ships its own tooling and is out of fleet-tooling scope.
//
// Bypass: `Allow other-linter bypass` typed verbatim in a recent user turn.
//
// Fails open on parse errors (better to under-block than brick a non-JSON edit).

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow other-linter bypass'

// A foreign linter/formatter config FILE (by basename / extension prefix).
const CONFIG_FILE_RE =
  /^(?:biome\.jsonc?|\.eslintrc(?:\.[a-z]+)?|eslint\.config\.[cm]?[jt]s|\.prettierrc(?:\.[a-z]+)?|prettier\.config\.[cm]?[jt]s|\.dprint\.jsonc?)$/

// A foreign linter/formatter PACKAGE name (exact or scoped/prefixed family).
function isForeignToolPackage(name: string): boolean {
  if (
    name === '@biomejs/biome' ||
    name === 'eslint' ||
    name === 'prettier' ||
    name === 'dprint' ||
    name === 'rome'
  ) {
    return true
  }
  // Scoped + prefix families: @eslint/*, @typescript-eslint/*, eslint-config-*,
  // eslint-plugin-*, @<scope>/eslint-*, prettier-plugin-*.
  return (
    name.startsWith('@eslint/') ||
    name.startsWith('@typescript-eslint/') ||
    name.startsWith('eslint-config-') ||
    name.startsWith('eslint-plugin-') ||
    name.startsWith('prettier-plugin-') ||
    /^@[^/]+\/eslint-/.test(name)
  )
}

// Path is inside a vendored-upstream tree → exempt (we never touch upstream;
// upstream ships its own tooling).
export function isVendoredUpstream(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/')
  return (
    /(?:^|\/)(?:upstream|vendor|third_party|external)(?:\/|$)/.test(p) ||
    /(?:^|\/)[^/]+-upstream(?:\/|$)/.test(p)
  )
}

// Foreign-tool packages declared in a package.json's dependency blocks.
export function foreignToolDeps(jsonText: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') {
    return []
  }
  const out: string[] = []
  for (const block of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const deps = (parsed as Record<string, unknown>)[block]
    if (deps && typeof deps === 'object') {
      for (const name of Object.keys(deps as Record<string, unknown>)) {
        if (isForeignToolPackage(name)) {
          out.push(name)
        }
      }
    }
  }
  return out
}

function bypassed(payload: { transcript_path?: string | undefined }): boolean {
  return (
    !!payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  )
}

// withEditGuard handles stdin drain, tool gate, file narrow, content extraction,
// fail-open on throw.
await withEditGuard((filePath, content, payload) => {
  if (isVendoredUpstream(filePath)) {
    return
  }
  const basename = path.basename(filePath)

  // (1) Foreign config FILE.
  if (CONFIG_FILE_RE.test(basename)) {
    if (bypassed(payload)) {
      return
    }
    logger.error(
      [
        `[no-other-linters-guard] Blocked: foreign linter/formatter config \`${basename}\`.`,
        '',
        '  The fleet uses oxlint + oxfmt ONLY (no ESLint/Prettier/Biome/dprint/rome).',
        '  Configure linting via the fleet oxlint plugin + `.config/fleet/oxlintrc.json`',
        '  and formatting via `.config/fleet/oxfmtrc.json`.',
        '',
        `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
        '',
      ].join('\n'),
    )
    process.exitCode = 2
    return
  }

  // (2) Foreign tool PACKAGE in a package.json dep block (Write or Edit).
  if (basename === 'package.json') {
    const afterText = content ?? ''
    if (!afterText) {
      return
    }
    const found = foreignToolDeps(afterText)
    if (found.length === 0) {
      return
    }
    if (bypassed(payload)) {
      return
    }
    found.sort()
    logger.error(
      [
        '[no-other-linters-guard] Blocked: foreign linter/formatter package(s) in package.json.',
        '',
        `  File:     ${filePath}`,
        `  Packages: ${found.map(n => `\`${n}\``).join(', ')}`,
        '',
        '  The fleet uses oxlint + oxfmt ONLY. Remove these deps; the fleet',
        '  oxlint plugin + oxfmt cover lint + format. Point package scripts at',
        '  `oxlint -c .config/fleet/oxlintrc.json` / `oxfmt -c .config/fleet/oxfmtrc.json`.',
        '',
        `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
        '',
      ].join('\n'),
    )
    process.exitCode = 2
  }
})
