/**
 * @file Claude Code PreToolUse(Bash) hook — cdn-allowlist-guard. Blocks a
 *   `curl` / `wget` / `fetch` to a host that isn't on the fleet's public-CDN /
 *   package-registry allowlist. Fetching from an arbitrary host mid-task is a
 *   supply-chain + exfiltration surface; the fleet pins fetches to approved
 *   public registries (crates.io, pypi.org, …) and public CDNs. All allowlist
 *   logic lives in _shared/cdn-allowlist.mts — the SAME module the commit-time
 *   check consumes, so the two never drift (code is law, DRY). The allowlist
 *   holds ONLY public hosts; an internal `*.svc.cluster.local` host is never on
 *   it (and a fetch to one is correctly blocked). AST-parses the command via
 *   shell-command.mts/findInvocation (per the no-command-regex-in-hooks rule)
 *   to detect the fetch binary, then scans the command's URLs. Bypass: `Allow
 *   cdn-allowlist bypass` in a recent user turn. Exit codes: 0 — pass; 2 —
 *   block. Fails open on any throw.
 */

import { findDisallowedCdn } from '../_shared/cdn-allowlist.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow cdn-allowlist bypass'

export const check = bashGuard((command, payload) => {
  const hit = findDisallowedCdn(command)
  if (!hit) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(
    [
      `[cdn-allowlist-guard] Blocked: fetch to off-allowlist host \`${hit.host}\`.`,
      '',
      `  URL: ${hit.url}`,
      '  Fetches must target an approved public package registry / CDN',
      '  (see _shared/cdn-allowlist.mts). An arbitrary fetch host mid-task',
      '  is a supply-chain + exfiltration surface.',
      '',
      '  Fix: fetch from an allowlisted registry/CDN, or add the host to',
      '  ALLOWED_CDN_HOSTS in _shared/cdn-allowlist.mts if it is a legitimate',
      '  PUBLIC registry (never an internal *.svc.cluster.local host).',
      '',
      `  Bypass: type \`${BYPASS_PHRASE}\` if this fetch is genuinely intended.`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
