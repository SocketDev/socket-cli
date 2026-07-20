/**
 * @file Claude Code PreToolUse hook — brew-supply-chain-guard. BLOCKS a Bash
 *   command that invokes `brew` when this machine's Homebrew is not hardened to
 *   the 6.0.0 supply-chain posture: either the installed Homebrew is below
 *   6.0.0, or HOMEBREW_REQUIRE_TAP_TRUST / HOMEBREW_CASK_OPTS_REQUIRE_SHA is
 *   unset. Why (https://brew.sh/2026/06/11/homebrew-6.0.0/): 6.0.0 added tap
 *   trust (refuse untrusted third-party tap code) + cask checksum enforcement
 *   (refuse a `sha256 :no_check` download). Both env knobs are silently ignored
 *   by an older brew, so a version floor is the only real enforcement. This is
 *   a distinct concern from package-manager-auto-update-guard
 *   (HOMEBREW_NO_AUTO_UPDATE); both read brew but for different reasons, so
 *   they're separate single-purpose guards. All detection lives in
 *   _shared/brew-supply-chain.mts (code is law, DRY) — shared with the check
 *   --all audit + setup-security-tools. A machine without brew on PATH
 *   (`absent`) passes — not applicable (CI runners legitimately lack brew).
 *   Bypass: `Allow brew-supply-chain bypass` typed verbatim in a recent user
 *   turn. Fails open on parse / payload errors (exit 0) — a guard bug must not
 *   wedge every Bash call.
 *
 * @dispatch-snapshot-exclude — NOT bundled into the V8 hook-dispatch snapshot.
 *   This hook's `_shared/brew-supply-chain.mts` imports
 *   `@socketsecurity/lib-stable/versions/{compare,parse}`, which pulls the lib's
 *   `semver`; semver's index builds `subset`'s `new Comparator(...)` at
 *   MODULE-EVAL, throwing `SemVer is not a constructor` under V8's
 *   `--build-snapshot` builder. Until the version helpers are made lazy, this
 *   guard runs the normal per-hook way rather than from the frozen heap.
 */

import {
  BREW_MIN_VERSION,
  commandInvokesBrew,
  detectBrewSecurity,
} from '../_shared/brew-supply-chain.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'

export function formatBlock(reason: string): string {
  return (
    [
      `[brew-supply-chain-guard] Blocked: Homebrew is not hardened to the ${BREW_MIN_VERSION} supply-chain posture.`,
      '',
      `  ${reason}`,
      '',
      '  Homebrew 6.0.0 adds tap trust + cask checksum enforcement. An older',
      '  brew ignores the env knobs, so the version floor is the gate. Fix:',
      '',
      '    • upgrade:  brew update && brew upgrade   (to >= 6.0.0)',
      '    • harden:   node .claude/hooks/fleet/setup-security-tools/install.mts',
      '                (sets HOMEBREW_REQUIRE_TAP_TRUST + HOMEBREW_CASK_OPTS_REQUIRE_SHA)',
    ].join('\n') + '\n'
  )
}

export const hook = defineHook({
  bypass: ['brew-supply-chain'],
  check: bashGuard(command => {
    if (!command.trim() || !commandInvokesBrew(command)) {
      return undefined
    }

    const status = detectBrewSecurity()
    if (status.state !== 'unhardened') {
      return undefined
    }

    return block(formatBlock(status.reason))
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
