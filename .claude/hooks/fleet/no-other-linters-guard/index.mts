#!/usr/bin/env node
// Claude Code PreToolUse hook — no-other-linters-guard.
//
// The fleet uses oxlint + oxfmt ONLY. No ESLint, Prettier, Biome, dprint, or
// rome. This guard blocks introducing them at edit time, two ways:
//
//   1. Creating / editing a foreign linter/formatter CONFIG file:
//      biome.json(c), .eslintrc*, eslint.config.*, .prettierrc*,
//      prettier.config.*, .dprint.json* . Unconditional — host APIs used in
//      tests (ESLint RuleTester/Linter, Babel programmatic) need no config.
//   2. Adding a foreign linter/formatter PACKAGE to a package.json's
//      dependency blocks: @biomejs/biome, eslint, @eslint/*,
//      @typescript-eslint/*, prettier, dprint, rome (+ eslint-config-* /
//      eslint-plugin-* / prettier-plugin-* / @<scope>/eslint-* families).
//
//      EXCEPTION — host-test deps: a package that ADAPTS TO a foreign tool
//      (e.g. converts plugins into ESLint rules) may integration-test against
//      it by declaring `"fleet": { "hostTestDeps": ["eslint"] }`. The
//      allowance holds only in devDependencies/peerDependencies and only
//      while no package script invokes the tool. Contract + audit logic live
//      in `_shared/foreign-linters.mts`.
//
// Complements `socket/no-eslint-biome-config-ref` (which REPORTS stale string
// refs in TS/JS source) and
// `scripts/fleet/check/linters-are-oxlint-oxfmt-only.mts` (which gates
// committed state via the same shared audit). This is the edit-time block on
// the surfaces those miss — config files + package.json dep blocks.
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

import {
  auditForeignDeps,
  isForeignConfigFile,
  isVendoredUpstream,
} from '../_shared/foreign-linters.mts'
import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow other-linter bypass'

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

  // (1) Foreign config FILE — unconditional block.
  if (isForeignConfigFile(basename)) {
    if (bypassed(payload)) {
      return
    }
    logger.error(
      [
        `[no-other-linters-guard] Blocked: foreign linter/formatter config \`${basename}\`.`,
        '',
        '  The fleet uses oxlint + oxfmt ONLY (no ESLint/Prettier/Biome/dprint/rome).',
        '  Configure linting via the fleet oxlint plugin + `.config/fleet/oxlintrc.json`',
        '  and formatting via `.config/fleet/oxfmtrc.json`. Integration tests against',
        '  a foreign host use its programmatic API (RuleTester/Linter) — no config file.',
        '',
        `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
        '',
      ].join('\n'),
    )
    process.exitCode = 2
    return
  }

  // (2) Foreign tool PACKAGE in a package.json dep block (Write or Edit),
  // minus deps allowed under the `fleet.hostTestDeps` host-test contract.
  if (basename === 'package.json') {
    const afterText = content ?? ''
    if (!afterText) {
      return
    }
    const { blocked } = auditForeignDeps(afterText)
    if (blocked.length === 0) {
      return
    }
    if (bypassed(payload)) {
      return
    }
    logger.error(
      [
        '[no-other-linters-guard] Blocked: foreign linter/formatter package(s) in package.json.',
        '',
        `  File: ${filePath}`,
        ...blocked.map(f => `  - \`${f.name}\` — ${f.reason}`),
        '',
        '  The fleet lints + formats with oxlint + oxfmt ONLY. Two valid moves:',
        '  • Integration-testing an adapter AGAINST a foreign host? Declare it:',
        '      "fleet": { "hostTestDeps": ["<package>"] }',
        '    and keep the dep in devDependencies/peerDependencies with no package',
        '    script invoking it.',
        '  • Anything else: remove the dep; the fleet oxlint plugin + oxfmt cover',
        '    lint + format. Point package scripts at',
        '    `oxlint -c .config/fleet/oxlintrc.json` / `oxfmt -c .config/fleet/oxfmtrc.json`.',
        '',
        `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
        '',
      ].join('\n'),
    )
    process.exitCode = 2
  }
})
