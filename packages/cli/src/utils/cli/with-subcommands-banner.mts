/**
 * ASCII banner rendering for the Socket CLI top-of-command output.
 *
 * Extracted from with-subcommands.mts to keep that file under the
 * 1000-line File size hard cap. The banner functions are a cohesive
 * unit: getAsciiHeader composes the logo + info lines, emitBanner
 * writes the result to stderr, shouldAnimateHeader / getHeaderTheme /
 * getTokenOrigin / shouldSuppressBanner are read-only helpers that
 * feed into it.
 */

import colors from 'yoctocolors-cjs'

import { getCI } from '@socketsecurity/lib/env/ci'
import {
  getSocketCliApiToken,
  getSocketCliNoApiToken,
} from '@socketsecurity/lib/env/socket-cli'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

import { FLAG_ORG, REDACTED } from '../../constants/cli.mts'
import {
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_DEFAULT_ORG,
} from '../../constants/config.mts'
import { getCliVersion } from '../../env/cli-version.mts'
import { getCliVersionHash } from '../../env/cli-version-hash.mts'
import { VITEST } from '../../env/vitest.mts'
import { getConfigValueOrUndef, isConfigFromFlag } from '../config.mts'
import { isDebug } from '../debug.mts'
import { tildify } from '../fs/home-path.mts'
import { getVisibleTokenPrefix } from '../socket/sdk.mjs'
import {
  renderLogoWithFallback,
  supportsFullColor,
} from '../terminal/ascii-header.mts'

import type { HeaderTheme } from '../terminal/ascii-header.mts'

const logger = getDefaultLogger()

/**
 * Determine the origin of the API token (env var, config, --config flag, or none).
 * Used in the banner to show the user where the active token is coming from.
 */
export function getTokenOrigin(): string {
  if (getSocketCliNoApiToken()) {
    return ''
  }
  if (getSocketCliApiToken()) {
    return '(env)'
  }
  const configToken = getConfigValueOrUndef(CONFIG_KEY_API_TOKEN)
  if (configToken) {
    return isConfigFromFlag() ? '(--config flag)' : '(config)'
  }
  return ''
}

/**
 * Get header theme from flags or use default.
 */
export function getHeaderTheme(flags?: Record<string, unknown>): HeaderTheme {
  const theme = flags?.['headerTheme']
  const validThemes: HeaderTheme[] = [
    'default',
    'cyberpunk',
    'forest',
    'ocean',
    'sunset',
  ]
  return validThemes.includes(theme as HeaderTheme)
    ? (theme as HeaderTheme)
    : 'default'
}

/**
 * Determine if header should animate (shimmer effect).
 */
export function shouldAnimateHeader(flags?: Record<string, unknown>): boolean {
  // Disable animation in CI, tests, or when explicitly disabled.
  if (getCI() || VITEST || !process.stdout.isTTY || !supportsFullColor()) {
    return false
  }
  /* c8 ignore next 6 - VITEST is true under tests so the early-return above always fires; the flag-check + default-true paths require an interactive TTY */
  if (flags && 'animateHeader' in flags) {
    return Boolean(flags['animateHeader'])
  }
  return true
}

/**
 * Strip ANSI codes for length calculation.
 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * Generate the ASCII banner header for Socket CLI commands.
 */
export function getAsciiHeader(
  command: string,
  orgFlag: string | undefined,
  compactMode = false,
  flags?: Record<string, unknown>,
) {
  // Note: In tests we return <redacted> because otherwise snapshots will fail.
  const redacting = VITEST

  // Version display: show hash in debug mode, otherwise show semantic version.
  const fullVersion = getCliVersion()
  const versionHash = getCliVersionHash()
  const cliVersion = redacting
    ? REDACTED
    : isDebug()
      ? versionHash
      : `v${fullVersion}`

  const nodeVersion = redacting ? REDACTED : process.version
  const showNodeVersion = !redacting && isDebug()
  const defaultOrg = getConfigValueOrUndef(CONFIG_KEY_DEFAULT_ORG)

  // Token display with origin indicator.
  const tokenPrefix = getVisibleTokenPrefix()
  const tokenOrigin = redacting ? '' : getTokenOrigin()
  const noApiToken = getSocketCliNoApiToken()
  const shownToken = redacting
    ? REDACTED
    : noApiToken
      ? colors.red('(disabled)')
      : tokenPrefix
        ? `${colors.green(tokenPrefix)}***${tokenOrigin ? ` ${tokenOrigin}` : ''}`
        : colors.yellow('(not set)')

  const relCwd = redacting ? REDACTED : normalizePath(tildify(process.cwd()))

  // Consolidated org display format.
  const orgPart = redacting
    ? `org: ${REDACTED}`
    : orgFlag
      ? `org: ${colors.cyan(orgFlag)} (${FLAG_ORG} flag)`
      : defaultOrg && defaultOrg !== 'null'
        ? `org: ${colors.cyan(defaultOrg)} (config)`
        : colors.yellow('org: (not set)')

  // Compact mode for CI/automation.
  if (compactMode) {
    const compactToken = noApiToken
      ? '(disabled)'
      : tokenPrefix
        ? `${tokenPrefix}***${tokenOrigin ? ` ${tokenOrigin}` : ''}`
        : '(not set)'
    const compactOrg =
      orgFlag ||
      (defaultOrg && defaultOrg !== 'null' ? defaultOrg : '(not set)')
    return `CLI: ${cliVersion} | cmd: ${command} | org: ${compactOrg} | token: ${compactToken}`
  }

  // Get theme for header styling.
  const theme = getHeaderTheme(flags)
  const animate = shouldAnimateHeader(flags)

  // Render animated logo if supported, otherwise static.
  // Use frame 0 for static render in non-animated mode.
  const frame = animate ? Math.floor(Date.now() / 100) % 20 : null
  const logo = renderLogoWithFallback(frame, theme)

  // Build info lines.
  const infoLines = [
    '/---------------',
    `| CLI: ${cliVersion}`,
    `| ${showNodeVersion ? `Node: ${nodeVersion}, ` : ''}token: ${shownToken}, ${orgPart}`,
    `| Command: \`${command}\`, cwd: ${relCwd}`,
  ]

  // Combine logo and info side-by-side.
  const logoLines = logo.split('\n')
  const combinedLines: string[] = []

  for (let i = 0; i < Math.max(logoLines.length, infoLines.length); i++) {
    const logoLine = logoLines[i] || ''
    const infoLine = infoLines[i] || ''
    // Pad logo line to consistent width (36 chars for the ASCII art).
    const paddedLogo =
      logoLine + ' '.repeat(Math.max(0, 36 - stripAnsi(logoLine).length))
    combinedLines.push(`  ${paddedLogo}${infoLine}`)
  }

  return combinedLines.join('\n')
}

/**
 * Determine if the banner should be suppressed based on output flags.
 */
export function shouldSuppressBanner(flags: Record<string, unknown>): boolean {
  return Boolean(
    flags['json'] || flags['markdown'] || flags['banner'] === false,
  )
}

/**
 * Emit the Socket CLI banner to stderr for branding and debugging.
 */
export function emitBanner(
  name: string,
  orgFlag: string | undefined,
  compactMode = false,
  flags?: Record<string, unknown>,
) {
  // Print a banner at the top of each command.
  // This helps with brand recognition and marketing.
  // It also helps with debugging since it contains version and command details.
  // Note: print over stderr to preserve stdout for flags like --json and
  //       --markdown. If we don't do this, you can't use --json in particular
  //       and pipe the result to other tools. By emitting the banner over stderr
  //       you can do something like `socket scan view xyz | jq | process`.
  //       The spinner also emits over stderr for example.
  logger.error(getAsciiHeader(name, orgFlag, compactMode, flags))
}
