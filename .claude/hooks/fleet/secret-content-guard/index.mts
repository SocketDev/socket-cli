#!/usr/bin/env node
// Claude Code PreToolUse(Write|Edit) hook — secret-content-guard.
//
// Blocks a Write / Edit whose content carries a literal secret VALUE shape
// (`AKIA…`, `ghp_…`, `sktsec_…`, a JWT, a PEM private-key header, …). This is
// the EDIT-TIME twin of the commit-time secret scan in
// `.git-hooks/_shared/helpers.mts` (scanAwsKeys / scanGitHubTokens /
// scanPrivateKeys / scanSocketApiKeys) and the BASH-TIME `token-guard`: a
// secret written into a file was previously caught only at commit, so it sat
// in the working tree (and got read back, echoed, cached) until then. All
// three gates read the SAME `_shared/token-patterns.mts` SECRET_VALUE_PATTERNS
// catalog, so a new vendor shape is added once (code is law, DRY).
//
// The matched secret is NEVER logged — only its vendor label — so the block
// message itself can't leak the credential.
//
// Bypass: `Allow secret-content bypass` in a recent user turn (e.g. authoring
// this guard's own test fixtures, or a documented redacted example).
//
// Exit codes: 0 — pass; 2 — block. Fails open on any throw.

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { scanSecretValues } from '../_shared/token-patterns.mts'

export const check = editGuard((filePath, content, _payload) => {
  if (content === undefined) {
    return undefined
  }
  const hit = scanSecretValues(content)
  if (!hit) {
    return undefined
  }
  return block(
    [
      `[secret-content-guard] Blocked: ${hit.label} in content written to ${filePath}.`,
      '',
      '  A literal secret value must never be written into a tracked file —',
      '  it would sit in the working tree and land at commit. (Matched secret',
      '  withheld from this message so the block itself does not leak it.)',
      '',
      '  Fix: remove the secret. Tokens live in env vars (CI) or the OS',
      '  keychain (dev) — never hardcoded. For a doc example, use a redacted',
      '  placeholder.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['secret-content'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
