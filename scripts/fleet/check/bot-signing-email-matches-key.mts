#!/usr/bin/env node
/*
 * @file Fleet-wide check: a GitHub Actions workflow that GPG-signs commits as
 *   the Socket automation bot MUST set the committer email to the BARE
 *   `socket-bot@users.noreply.github.com` — the UID on the registered
 *   BOT_GPG_PRIVATE_KEY key (`922630D33925D208`) — NOT the numeric-prefixed
 *   `94589996+socket-bot@users.noreply.github.com`.
 *
 *   Why the distinction is load-bearing (the difference is NOT cosmetic):
 *
 *     - GitHub marks a GPG signature **Verified** only when the commit's
 *       committer email matches a UID on the signing key. The Socket Bot key's
 *       UID is the BARE address. A numeric-prefixed committer email is signed
 *       fine locally (`git tag -s` succeeds) but lands as **Unverified** —
 *       and a branch/repo "Require commit signing" ruleset then REJECTS the
 *       push. This exact mismatch made the wheelhouse release orchestrator's
 *       bump-commit push fail after a fully green gate + signed tag.
 *     - The numeric-prefixed form exists for the OPPOSITE case: NON-GPG /
 *       web-flow / API commits (GraphQL createCommitOnBranch, gh-aw
 *       `signed-commits: true`, or plain unsigned), where GitHub's web-flow key
 *       signs server-side and the numeric prefix links the commit to the
 *       socket-bot account avatar/profile. `scripts/fleet/constants/
 *       bot-identity.mts` SOCKET_BOT.email is the numeric form — correct for
 *       the web-flow path, WRONG for the GPG path. This check is what keeps a
 *       future edit from pasting the numeric email into a GPG-signing job.
 *
 *   Detection is BODY-DRIVEN, not name-guessing. A workflow "GPG-signs" when its
 *   body imports the bot key or configures git to sign: the setup-git-signing
 *   composite, a BOT_GPG_PRIVATE_KEY import, `commit.gpgsign true`,
 *   `git tag -s`, or `git commit -S`. A workflow that sets NO socket-bot
 *   committer email, or that GPG-signs with the correct bare email, or that is
 *   non-GPG, is not a finding.
 *
 *   Pure classification (`classifyBotSigningEmail`) is exported for unit tests;
 *   the scan/report is the thin CLI shell. STRICT (exit 1): the rule is a hard
 *   push-blocker, so a violation must fail the gate rather than merely warn.
 *
 *   Usage: node scripts/fleet/check/bot-signing-email-matches-key.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { collectTrackedFiles } from '../_shared/tracked-globs.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The bare socket-bot committer email is the UID on the registered
// BOT_GPG_PRIVATE_KEY key — the only committer email a GPG-signed bot commit
// verifies against.
const BARE_BOT_EMAIL = 'socket-bot@users.noreply.github.com'

// A numeric-prefixed socket-bot noreply address (`<id>+socket-bot@...`). The
// numeric prefix links the account for web-flow/API commits but is NOT a key
// UID, so it never verifies a GPG signature.
// require-regex-comment: `\d+\+` is the GitHub numeric-noreply prefix; the rest
// is the fixed socket-bot noreply host.
const NUMERIC_BOT_EMAIL_RE = /\d+\+socket-bot@users\.noreply\.github\.com/

// Signals that a workflow BODY GPG-signs commits as the bot. Any one is enough.
// require-regex-comment: the fleet's GPG-signing surfaces — the shared
// setup-git-signing composite, a raw BOT_GPG_PRIVATE_KEY import, an explicit
// gpgsign config, or a signed tag/commit invocation.
const GPG_SIGNING_SIGNALS: readonly RegExp[] = [
  /setup-git-signing/,
  /BOT_GPG_PRIVATE_KEY/,
  /gpg\s+--batch\s+--import/,
  /commit\.gpgsign\s+true/,
  /git\s+tag\s+-s\b/,
  /git\s+commit\b[^\n]*\s-S\b/,
]

export interface BotSigningEmailVerdict {
  readonly gpgSigns: boolean
  readonly usesNumericBotEmail: boolean
  readonly ok: boolean
  readonly issues: readonly string[]
}

/**
 * Classify one workflow (filename + body) against the bot-signing-email rule.
 * Returns a verdict when the body sets a numeric socket-bot committer email
 * AND GPG-signs, the push-blocking mismatch, otherwise null (no socket-bot
 * signing identity, or already correct). Pure so it is unit-tested without a
 * filesystem.
 */
export function classifyBotSigningEmail(
  _fileName: string,
  body: string,
): BotSigningEmailVerdict | null {
  const trimmed = body.trim()
  if (!trimmed) {
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- external API contract: the unit test suite asserts strict equality against this exact `null` return value
    return null
  }
  const usesNumericBotEmail = NUMERIC_BOT_EMAIL_RE.test(trimmed)
  // Only the numeric form is a candidate violation — a workflow with no
  // numeric socket-bot email cannot mis-verify, regardless of signing.
  if (!usesNumericBotEmail) {
    // oxlint-disable-next-line socket/prefer-undefined-over-null -- external API contract: the unit test suite asserts strict equality against this exact `null` return value
    return null
  }
  const gpgSigns = GPG_SIGNING_SIGNALS.some(re => re.test(trimmed))
  const issues: string[] = []
  if (gpgSigns) {
    issues.push(
      `GPG-signs but sets the numeric socket-bot committer email — use the ` +
        `bare ${BARE_BOT_EMAIL} (the BOT_GPG_PRIVATE_KEY key UID) or GitHub ` +
        `marks the commit Unverified and a "Require commit signing" ruleset ` +
        `rejects the push`,
    )
  }
  return {
    gpgSigns,
    usesNumericBotEmail,
    ok: issues.length === 0,
    issues,
  }
}

export interface BotSigningEmailFinding {
  readonly file: string
  readonly issues: readonly string[]
}

export async function scanRepo(
  repoRoot: string,
): Promise<BotSigningEmailFinding[]> {
  const workflows = await collectTrackedFiles(
    ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
    { cwd: repoRoot },
  )
  const findings: BotSigningEmailFinding[] = []
  for (const rel of workflows) {
    const abs = path.join(repoRoot, rel)
    if (!existsSync(abs)) {
      continue
    }
    let body: string
    try {
      body = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const verdict = classifyBotSigningEmail(rel, body)
    if (verdict && !verdict.ok) {
      findings.push({ file: rel, issues: verdict.issues })
    }
  }
  return findings
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet')
  const findings = await scanRepo(REPO_ROOT)
  if (!findings.length) {
    if (!quiet) {
      logger.success(
        '[bot-signing-email-matches-key] every GPG-signing bot workflow uses ' +
          'the bare socket-bot key-UID email.',
      )
    }
    return 0
  }
  logger.fail(
    `[bot-signing-email-matches-key] ${findings.length} workflow(s) GPG-sign ` +
      `with the numeric socket-bot email (Unverified → push rejected):`,
  )
  logger.group()
  for (const f of findings) {
    logger.fail(f.file)
    logger.group()
    for (const issue of f.issues) {
      logger.fail(issue)
    }
    logger.groupEnd()
  }
  logger.groupEnd()
  logger.log(
    `Fix: set the committer email to the bare ${BARE_BOT_EMAIL} on the ` +
      `GPG-signing job (setup-git-signing user-email, or git config ` +
      `user.email). The numeric-prefixed form is only for non-GPG / web-flow ` +
      `commits. See scripts/fleet/constants/bot-identity.mts.`,
  )
  process.exitCode = 1
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks that GPG-signing bot workflows use the bare socket-bot key-UID email',
  help: `Usage: node scripts/fleet/check/bot-signing-email-matches-key.mts [--quiet]

  --quiet  suppress the success line`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
