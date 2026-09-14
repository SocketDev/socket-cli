import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { SOCKET_JSON } from '../../constants/socket.mts'
import { outputDryRunExecute } from '../../util/dry-run/output.mts'

import type { SocketJson } from '../../util/socket/json.mts'

const logger = getDefaultLogger()

export function outputGradleManifestDryRun(
  cwd: string,
  bin: string,
  gradleOpts: readonly string[],
  mode: 'facts' | 'pom',
  ecosystem: 'Gradle' | 'Kotlin',
): void {
  const args = [cwd, '--bin', bin]
  if (gradleOpts.length) {
    args.push('--gradle-opts', gradleOpts.join(' '))
  }
  outputDryRunExecute(
    'gradlew',
    args,
    mode === 'facts'
      ? `generate .socket.facts.json from ${ecosystem} project`
      : `generate pom.xml from ${ecosystem} project`,
  )
}

export function resolveGradleExcludeConfigs(
  socketJson: SocketJson,
  value: string | undefined,
): string {
  if (value !== undefined) {
    return value
  }
  const configured = socketJson.defaults?.manifest?.gradle?.excludeConfigs
  if (configured === undefined) {
    return ''
  }
  logger.info(
    `Using default --exclude-configs from ${SOCKET_JSON}:`,
    configured,
  )
  return configured
}

export function resolveGradleFacts(
  socketJson: SocketJson,
  options?:
    | {
        facts?: boolean | undefined
        pom?: boolean | undefined
      }
    | undefined,
): boolean {
  const { facts, pom } = { __proto__: null, ...options }
  let resolved = facts
  if (resolved === undefined) {
    resolved = socketJson.defaults?.manifest?.gradle?.facts ?? true
    if (socketJson.defaults?.manifest?.gradle?.facts !== undefined) {
      logger.info(`Using default --facts from ${SOCKET_JSON}:`, resolved)
    }
  }
  if (!pom) {
    return resolved
  }
  if (facts !== undefined) {
    logger.warn(
      'The `--facts` and `--pom` options are mutually exclusive; generating Socket facts.',
    )
    return resolved
  }
  return false
}

export function resolveGradleIgnoreUnresolved(
  socketJson: SocketJson,
  options?: { value?: boolean | undefined } | undefined,
): boolean {
  const { value } = { __proto__: null, ...options }
  if (value !== undefined) {
    return value
  }
  const configured =
    socketJson.defaults?.manifest?.gradle?.ignoreUnresolved ?? false
  if (socketJson.defaults?.manifest?.gradle?.ignoreUnresolved !== undefined) {
    logger.info(
      `Using default --ignore-unresolved from ${SOCKET_JSON}:`,
      configured,
    )
  }
  return configured
}

export function resolveGradleIncludeConfigs(
  socketJson: SocketJson,
  value: string | undefined,
): string {
  if (value !== undefined) {
    return value
  }
  const configured = socketJson.defaults?.manifest?.gradle?.includeConfigs
  if (configured === undefined) {
    return ''
  }
  logger.info(
    `Using default --include-configs from ${SOCKET_JSON}:`,
    configured,
  )
  return configured
}

export function resolveGradleVerbose(
  socketJson: SocketJson,
  options?: { value?: boolean | undefined } | undefined,
): boolean {
  const { value } = { __proto__: null, ...options }
  if (value !== undefined) {
    return value
  }
  const configured = socketJson.defaults?.manifest?.gradle?.verbose ?? false
  if (socketJson.defaults?.manifest?.gradle?.verbose !== undefined) {
    logger.info(`Using default --verbose from ${SOCKET_JSON}:`, configured)
  }
  return configured
}

export function warnGradlePomOnlyFlags(
  mode: 'facts' | 'pom',
  options?:
    | {
        excludeConfigs?: string | undefined
        ignoreUnresolved?: boolean | undefined
        includeConfigs?: string | undefined
      }
    | undefined,
): void {
  const { excludeConfigs, ignoreUnresolved, includeConfigs } = {
    __proto__: null,
    ...options,
  }
  if (
    mode === 'pom' &&
    (includeConfigs !== undefined ||
      excludeConfigs !== undefined ||
      ignoreUnresolved !== undefined)
  ) {
    logger.warn(
      'The `--include-configs`, `--exclude-configs`, and `--ignore-unresolved` options only apply when generating Socket facts (not with `--pom`); ignoring them.',
    )
  }
}
