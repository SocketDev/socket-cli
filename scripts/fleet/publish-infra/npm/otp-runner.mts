/*
 * @file Pick how to run a registry command that may hit a 2FA challenge.
 *   The problem: `pnpm stage approve` defers proof-of-presence to promote time,
 *   and the OTP prompt gates on `isTTY`. An agent, a cron, and `! <cmd>` in a
 *   chat session all run without a TTY, so the command dies with
 *   ERR_PNPM_OTP_NON_INTERACTIVE before it ever reaches the registry. That is
 *   not a permissions problem and no token fixes it.
 *   Three ways out, in the order this module prefers them:
 *
 *   1. NATIVE — pnpm >= 11.19.0 does web auth without a TTY, printing the
 *      authentication URL instead of demanding a terminal (pnpm/pnpm#13479).
 *      Nothing to wrap: spawn it directly and surface the URL.
 *   2. PTY — wrap the same command in the system `script` binary so the child
 *      believes it has a terminal. Verified to carry pnpm 11.10 all the way to
 *      the web-OTP challenge, so this is the universal fallback on any POSIX
 *      host regardless of pnpm version.
 *   3. NPM — npm ships the same `stage` surface (`publish`/`list`/`view`/
 *      `approve`/`reject`/`download`). When pnpm is too old AND no PTY exists
 *      (Windows has no `script`), fall back to npm at or above NPM_MIN. Kept
 *      pure over (versions, platform) so every branch is unit-testable without
 *      a registry, a PTY, or either binary installed.
 */

// pnpm's first release carrying non-interactive web auth. Note the release
// note scopes it to `pnpm login`; whether `stage approve`'s OTP path inherits
// it is NOT established, which is why NATIVE is a preference rather than a
// guarantee and PTY remains the fallback rather than being retired.
export const PNPM_NATIVE_WEB_AUTH = '11.19.0'

// npm's floor for the fallback. npm has carried the `stage` subcommands since
// 11.x; 12 is the fleet's supported line.
export const NPM_MIN = '12.0.0'

export type OtpStrategy = 'native' | 'pty' | 'npm' | 'unavailable'

export type OtpPlan = {
  /**
   * Why this strategy won, for the operator-facing message.
   */
  reason: string
  strategy: OtpStrategy
}

/**
 * Compare two dotted version strings. Returns <0, 0 or >0. Prerelease suffixes
 * are ignored: `11.19.0-rc.1` compares equal to `11.19.0`, which is the right
 * call for a capability gate — a release candidate carries the capability.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('-')[0]!.split('.')
  const partsB = b.split('-')[0]!.split('.')
  for (let i = 0; i < 3; i += 1) {
    const na = Number(partsA[i] ?? 0)
    const nb = Number(partsB[i] ?? 0)
    if (na !== nb) {
      return na < nb ? -1 : 1
    }
  }
  return 0
}

/**
 * True when `version` is at or above `floor`. An unparseable version answers
 * false: an unknown build must not be credited with a capability.
 */
export function atLeast(version: string | undefined, floor: string): boolean {
  if (!version || !/^\d+\.\d+/.test(version)) {
    return false
  }
  return compareVersions(version, floor) >= 0
}

/**
 * Windows has no `script(1)`, so the PTY route does not exist there.
 */
export function hasPty(platform: NodeJS.Platform): boolean {
  return platform !== 'win32'
}

/**
 * Choose how to run the challenge-bearing command.
 *
 * `hasTty` short-circuits everything: with a real terminal the plain command
 * already works and wrapping it would only add a layer that mangles the
 * prompt's rendering.
 */
export function planOtpRun(config: {
  hasTty: boolean
  npmVersion: string | undefined
  platform: NodeJS.Platform
  pnpmVersion: string | undefined
}): OtpPlan {
  const { hasTty, npmVersion, platform, pnpmVersion } = config
  if (hasTty) {
    return {
      reason: 'a real terminal is attached, so the prompt works unwrapped',
      strategy: 'native',
    }
  }
  if (atLeast(pnpmVersion, PNPM_NATIVE_WEB_AUTH)) {
    return {
      reason: `pnpm ${pnpmVersion} >= ${PNPM_NATIVE_WEB_AUTH} does web auth without a TTY`,
      strategy: 'native',
    }
  }
  if (hasPty(platform)) {
    return {
      reason: pnpmVersion
        ? `pnpm ${pnpmVersion} < ${PNPM_NATIVE_WEB_AUTH}, so wrap it in a PTY via script(1)`
        : 'pnpm version unknown, so wrap it in a PTY via script(1)',
      strategy: 'pty',
    }
  }
  if (atLeast(npmVersion, NPM_MIN)) {
    return {
      reason: `no script(1) on ${platform}; npm ${npmVersion} >= ${NPM_MIN} carries the same stage surface`,
      strategy: 'npm',
    }
  }
  return {
    reason: `no TTY, pnpm < ${PNPM_NATIVE_WEB_AUTH}, no script(1) on ${platform}, and npm < ${NPM_MIN}`,
    strategy: 'unavailable',
  }
}

/**
 * The concrete argv for a plan. `pty` returns the `script(1)` form, which
 * differs between util-linux (`-c "<cmd>"`) and macOS/BSD (trailing args).
 */
export function otpCommand(
  plan: OtpPlan,
  platform: NodeJS.Platform,
  args: readonly string[],
): { args: string[]; command: string } | undefined {
  if (plan.strategy === 'npm') {
    return { args: [...args], command: 'npm' }
  }
  if (plan.strategy === 'native') {
    return { args: [...args], command: 'pnpm' }
  }
  if (plan.strategy === 'pty') {
    if (platform === 'linux') {
      const inner = ['pnpm', ...args].map(quoteForShell).join(' ')
      return { args: ['-q', '-c', inner, '/dev/null'], command: 'script' }
    }
    return { args: ['-q', '/dev/null', 'pnpm', ...args], command: 'script' }
  }
  return undefined
}

/**
 * Single-quote a token for a POSIX shell, closing and reopening around any
 * embedded quote. Only the linux `script -c` form interpolates a string, so
 * this is the one place a token re-enters a shell.
 */
export function quoteForShell(token: string): string {
  return `'${token.replaceAll("'", `'\\''`)}'`
}
