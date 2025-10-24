import colors from 'yoctocolors-cjs'

import { normalizePath } from '@socketsecurity/lib/path'

import {
  FLAG_ORG,
  REDACTED,
} from '../../constants/cli.mts'
import {
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_DEFAULT_ORG,
} from '../../constants/config.mts'
import ENV, { getCliVersion, getCliVersionHash } from '../../constants/env.mts'
import { isDebug } from '../debug.mts'
import { tildify } from '../fs/home-path.mts'
import { getVisibleTokenPrefix } from '../socket/sdk.mjs'
import {
  renderLogoWithFallback,
  supportsFullColor,
} from './ascii-header.mts'

import type { HeaderTheme } from './ascii-header.mts'
import { getConfigValueOrUndef, isConfigFromFlag } from '../config.mts'

/**
 * Determine the origin of the API token.
 */
function getTokenOrigin(): string {
  if (ENV.SOCKET_CLI_NO_API_TOKEN) {
    return ''
  }
  if (ENV.SOCKET_CLI_API_TOKEN) {
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
function getHeaderTheme(flags?: Record<string, unknown>): HeaderTheme {
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
function shouldAnimateHeader(flags?: Record<string, unknown>): boolean {
  // Disable animation in CI, tests, or when explicitly disabled.
  if (ENV.CI || ENV.VITEST || !process.stdout.isTTY || !supportsFullColor()) {
    return false
  }
  // Check flags first.
  if (flags && 'animateHeader' in flags) {
    return Boolean(flags['animateHeader'])
  }
  // Default to true for animated headers.
  return true
}

/**
 * Strip ANSI codes for length calculation.
 */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Need to match ANSI escape sequences.
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
): string {
  // Note: In tests/CI we redact and remove colors because otherwise snapshots will fail.
  const redacting = ENV.VITEST
  const inCI = ENV.CI

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
  const noApiToken = ENV.SOCKET_CLI_NO_API_TOKEN
  const shownToken = redacting
    ? REDACTED
    : inCI
      ? (noApiToken ? '(disabled)' : (tokenPrefix ? `${tokenPrefix}***${tokenOrigin ? ` ${tokenOrigin}` : ''}` : '(not set)'))
      : noApiToken
        ? colors.red('(disabled)')
        : tokenPrefix
          ? `${colors.green(tokenPrefix)}***${tokenOrigin ? ` ${tokenOrigin}` : ''}`
          : colors.yellow('(not set)')

  const relCwd = redacting ? REDACTED : normalizePath(tildify(process.cwd()))

  // Consolidated org display format.
  const orgPart = redacting
    ? `org: ${REDACTED}`
    : inCI
      ? (orgFlag ? `org: ${orgFlag} (${FLAG_ORG} flag)` : (defaultOrg && defaultOrg !== 'null' ? `org: ${defaultOrg} (config)` : 'org: (not set)'))
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

  // Plain ASCII logo for CI/VITEST (no colors).
  const plainLogo = [
    '   _____         _       _       ',
    '  |   __|___ ___| |_ ___| |_     ',
    "  |__   | . |  _| '_| -_|  _|    ",
    '  |_____|___|___|_,_|___|_|.dev  ',
  ].join('\n')

  // Get theme for header styling.
  const theme = getHeaderTheme(flags)
  const animate = shouldAnimateHeader(flags)

  // Render animated logo if supported, otherwise static.
  // Use frame 0 for static render in non-animated mode.
  // In CI/VITEST, always use plain text logo without colors.
  const logo = inCI || redacting ? plainLogo : renderLogoWithFallback(animate ? Math.floor(Date.now() / 100) % 20 : null, theme)

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
