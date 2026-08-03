/*
 * @file The prompt-less-setup audit's DECISIONS, split from its I/O.
 *
 *   Each `check*` in `../setup-is-prompt-less.mts` used to read a file, shell
 *   out, or probe the environment and decide in one body — which made the
 *   decisions unreachable from a test without a real HOME, a real gpg-agent,
 *   and a real Keychain. Every function here takes the already-gathered facts
 *   and returns a verdict; the caller does the gathering.
 *
 *   That split is not a coverage exercise. The first two functions pulled out
 *   this way each carried a reporting bug that had shipped unnoticed — an audit
 *   that names the wrong variable sends an operator to inspect a setting that
 *   was never the problem.
 */

// Both the audit and the --fix planner key on this, so it lives with the
// decisions rather than beside either caller.
export const CACHE_TTL_THRESHOLD_SECONDS = 28_800

export interface CheckResult {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
  readonly fix?: string | undefined
}

/**
 * Gpg-agent cache TTL verdict, given the parsed directive values.
 *
 * `undefined` for a TTL means the directive is absent, which is NOT the same as
 * a low value: gpg-agent falls back to 600s, so an absent directive is a
 * failure with a different fix than a present-but-too-low one.
 */
export function evaluateGpgAgentCacheTtl(inputs: {
  readonly confExists: boolean
  readonly defaultTtl: number | undefined
  readonly maxTtl: number | undefined
}): CheckResult {
  const name = 'gpg-agent cache TTL'
  if (!inputs.confExists) {
    return {
      detail:
        '~/.gnupg/gpg-agent.conf missing — defaults are 600s (10 min) which forces a fresh pinentry every ~10 minutes of work.',
      fix:
        'mkdir -p ~/.gnupg && cat >> ~/.gnupg/gpg-agent.conf <<EOF\n' +
        'default-cache-ttl 28800\n' +
        'max-cache-ttl 28800\n' +
        'default-cache-ttl-ssh 28800\n' +
        'max-cache-ttl-ssh 28800\n' +
        'EOF\n' +
        'gpg-connect-agent reloadagent /bye',
      name,
      ok: false,
    }
  }
  const { defaultTtl, maxTtl } = inputs
  if (defaultTtl === undefined || maxTtl === undefined) {
    const missing = [
      defaultTtl === undefined ? 'default-cache-ttl' : '',
      maxTtl === undefined ? 'max-cache-ttl' : '',
    ]
      .filter(Boolean)
      .join(' + ')
    return {
      detail: `gpg-agent.conf exists but is missing ${missing}; gpg-agent falls back to 600s defaults.`,
      fix:
        'Add the missing directives to ~/.gnupg/gpg-agent.conf:\n' +
        'default-cache-ttl 28800\nmax-cache-ttl 28800\n' +
        'Then: gpg-connect-agent reloadagent /bye',
      name,
      ok: false,
    }
  }
  if (
    defaultTtl < CACHE_TTL_THRESHOLD_SECONDS ||
    maxTtl < CACHE_TTL_THRESHOLD_SECONDS
  ) {
    return {
      detail: `default-cache-ttl=${defaultTtl}s, max-cache-ttl=${maxTtl}s. Threshold is ${CACHE_TTL_THRESHOLD_SECONDS}s (8h). Lower TTLs make pinentry re-prompt mid-session.`,
      fix: `Edit ~/.gnupg/gpg-agent.conf to set both default-cache-ttl and max-cache-ttl to ${CACHE_TTL_THRESHOLD_SECONDS} (8h). Then: gpg-connect-agent reloadagent /bye`,
      name,
      ok: false,
    }
  }
  return {
    detail: `default=${defaultTtl}s, max=${maxTtl}s (both ≥ ${CACHE_TTL_THRESHOLD_SECONDS}s threshold).`,
    name,
    ok: true,
  }
}

/**
 * GPG_TTY verdict, given the display path of the rc file that exports it.
 */
export function evaluateGpgTtyExported(
  foundInDisplayPath: string | undefined,
): CheckResult {
  const name = 'GPG_TTY exported in shell rc'
  if (foundInDisplayPath !== undefined) {
    return {
      detail: `found 'export GPG_TTY=...' in ${foundInDisplayPath}.`,
      name,
      ok: true,
    }
  }
  return {
    detail:
      'No `export GPG_TTY=$(tty)` found in ~/.zshenv / ~/.zshrc / ~/.bashrc / ~/.bash_profile / ~/.profile. pinentry needs GPG_TTY to find the controlling terminal in non-interactive shells (Claude Code, IDE integrations).',
    fix: "echo 'export GPG_TTY=$(tty)' >> ~/.zshenv  (or ~/.bashrc for bash)",
    name,
    ok: false,
  }
}

// `pinentry-program <path>` in gpg-agent.conf. Multiline so a directive on any
// line matches, and `\S+` stops at whitespace so a trailing comment is excluded.
const PINENTRY_PROGRAM_RE = /^\s*pinentry-program\s+(?<program>\S+)/m

/**
 * The configured pinentry program path, or undefined when none is set.
 */
export function pinentryProgramIn(
  confContent: string | undefined,
): string | undefined {
  return PINENTRY_PROGRAM_RE.exec(confContent ?? '')?.groups?.['program']
}

/**
 * Pinentry verdict. Non-macOS is a pass-by-skip: pinentry-mac is a macOS
 * Keychain integration, so there is nothing to assert elsewhere.
 */
export function evaluatePinentryProgram(inputs: {
  readonly isMacOs: boolean
  readonly program: string | undefined
  readonly programExists: boolean
}): CheckResult {
  const name = 'pinentry-program'
  if (!inputs.isMacOs) {
    return { detail: 'skipped (non-macOS).', name, ok: true }
  }
  const { program } = inputs
  if (program === undefined) {
    return {
      detail:
        'No `pinentry-program` set in ~/.gnupg/gpg-agent.conf. pinentry-mac integrates with macOS Keychain ("Save in Keychain" checkbox); without it, gpg may use a less-friendly fallback.',
      fix: 'brew install pinentry-mac && echo "pinentry-program $(brew --prefix)/bin/pinentry-mac" >> ~/.gnupg/gpg-agent.conf && gpg-connect-agent reloadagent /bye',
      name,
      ok: false,
    }
  }
  if (!program.includes('pinentry-mac')) {
    return {
      detail: `pinentry-program is ${program} — not pinentry-mac. pinentry-mac is the recommended choice on macOS (Keychain integration).`,
      fix: 'brew install pinentry-mac && sed -i "" "s|^pinentry-program .*|pinentry-program $(brew --prefix)/bin/pinentry-mac|" ~/.gnupg/gpg-agent.conf && gpg-connect-agent reloadagent /bye',
      name,
      ok: false,
    }
  }
  if (!inputs.programExists) {
    return {
      detail: `pinentry-program points at ${program} but that file doesn't exist.`,
      fix: 'brew install pinentry-mac  # restores the binary at the expected path',
      name,
      ok: false,
    }
  }
  return {
    detail: `${program} (pinentry-mac, Keychain-integrated).`,
    name,
    ok: true,
  }
}

/**
 * Commit.gpgsign verdict.
 *
 * Signing OFF is a PASS, not a failure: this audit is about prompt-lessness,
 * and a machine that never signs never prompts. Only `true` opens the
 * key-must-resolve arm.
 */
export function evaluateCommitGpgsign(inputs: {
  readonly gpgsignValue: string | undefined
  readonly signingKey: string | undefined
  readonly gpgFindsKey: boolean
}): CheckResult {
  const name = 'commit.gpgsign'
  const value = inputs.gpgsignValue?.trim() ?? ''
  if (!value) {
    return {
      detail: 'unset (no signing → no prompts; nothing to optimize).',
      name,
      ok: true,
    }
  }
  if (value !== 'true') {
    return {
      detail: `${value} (signing disabled; nothing to optimize).`,
      name,
      ok: true,
    }
  }
  const key = inputs.signingKey?.trim() ?? ''
  if (!key) {
    return {
      detail:
        'commit.gpgsign=true but user.signingkey is unset. Commits will fail or prompt for key selection on every sign.',
      fix:
        'gpg --list-secret-keys --keyid-format LONG  # find your key id\n' +
        'git config --global user.signingkey <KEYID>',
      name,
      ok: false,
    }
  }
  if (!inputs.gpgFindsKey) {
    return {
      detail: `signing key ${key} is configured but gpg can't find it. Every sign will fail.`,
      fix:
        'gpg --list-secret-keys --keyid-format LONG  # confirm or pick another key\n' +
        'git config --global user.signingkey <KEYID>',
      name,
      ok: false,
    }
  }
  return { detail: `enabled, key ${key} found.`, name, ok: true }
}

// The Keychain account the entry is stored under. Named once so the lookup and
// the failure message can never disagree — they previously did: the lookup used
// SOCKET_API_TOKEN while the message told the operator to go find a
// SOCKET_API_KEY entry that was never queried.
export const KEYCHAIN_SERVICE = 'socket-cli'
export const KEYCHAIN_ACCOUNT = 'SOCKET_API_TOKEN'

/**
 * MacOS Keychain token-entry verdict. Non-macOS is a pass-by-skip.
 */
export function evaluateKeychainTokenAcl(inputs: {
  readonly isMacOs: boolean
  readonly entryFound: boolean
}): CheckResult {
  const name = 'macOS Keychain token ACL'
  if (!inputs.isMacOs) {
    return { detail: 'skipped (non-macOS).', name, ok: true }
  }
  if (!inputs.entryFound) {
    return {
      detail: `No ${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT} entry in the Keychain. Tools that fall back to keychain (when env is empty) will prompt for input on first use.`,
      fix:
        'node .claude/hooks/fleet/setup-security-tools/install.mts\n' +
        '  # prompts for the token interactively and persists it to the Keychain with -T "" (any app can read).',
      name,
      ok: false,
    }
  }
  // The ACL itself cannot be inspected without triggering the very unlock
  // dialog this check exists to avoid, so a present entry is reported as OK
  // with the manual remedy attached rather than probed.
  return {
    detail: `${KEYCHAIN_SERVICE}/${KEYCHAIN_ACCOUNT} entry present. Assumes ACL=any app (-T "") from setup-security-tools — if you still get Keychain prompts, open Keychain Access → search "${KEYCHAIN_SERVICE}" → click "Always Allow" once for /usr/bin/security.`,
    name,
    ok: true,
  }
}
