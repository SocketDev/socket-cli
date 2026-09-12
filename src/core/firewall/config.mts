import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { envAsString } from '@socketsecurity/lib-stable/env/string'
import { safeProcessEnv } from '@socketsecurity/lib-stable/env/rewire'

import type { FirewallEnvironment } from './environment.mts'

export interface FirewallConfig {
  apiToken?: string | undefined
  certificatePath?: string | undefined
  keyPath?: string | undefined
  caDirectory: string
  customRegistries: string[]
  localRegistryAliases: string[]
  env: FirewallEnvironment
  failAction: 'block' | 'ignore'
  unknownHostAction: 'block' | 'warn' | 'ignore'
  upstreamProxy?: string | undefined
  jsonReportPath?: string | undefined
  reportMessage?: string | undefined
}

export function parseFirewallAction(
  value: string,
  name: string,
  fallback: 'block' | 'ignore',
): 'block' | 'warn' | 'ignore' {
  if (!value) {
    return fallback
  }
  if (value === 'block' || value === 'ignore' || value === 'warn') {
    return value
  }
  throw new Error(
    `Invalid firewall configuration at ${name}. Expected block, warn, or ignore. Set a supported action.`,
  )
}

export async function readFirewallConfig(
  options: {
    env?: FirewallEnvironment | undefined
    apiToken?: string | undefined
    home?: string | undefined
  } = {},
): Promise<FirewallConfig> {
  const home = options.home ?? os.homedir()
  const fileConfig = await readFirewallHomeConfig(home)
  const env: FirewallEnvironment = {
    ...fileConfig,
    ...(options.env ?? safeProcessEnv()),
  }
  const value = (name: string): string => envAsString(env[name])
  const certificatePath = value('SFW_CA_CERT_PATH') || undefined
  const keyPath = value('SFW_CA_KEY_PATH') || undefined
  validateFirewallCaPaths(certificatePath, keyPath)
  const apiToken =
    value('SOCKET_API_TOKEN') ||
    value('SOCKET_CLI_API_TOKEN') ||
    options.apiToken
  const failAction = value('SFW_FAIL_ACTION')
  validateFirewallFailAction(failAction)
  const upstreamProxy = value('SFW_UPSTREAM_PROXY') || undefined
  validateFirewallUpstreamProxy(upstreamProxy)
  return {
    apiToken: apiToken === 'sfw_free' ? undefined : apiToken,
    certificatePath,
    keyPath,
    caDirectory: path.join(home, '.socket', 'sfw'),
    customRegistries: value('SFW_CUSTOM_REGISTRIES')
      .split(/[,\s]+/)
      .filter(Boolean),
    localRegistryAliases: value('SFW_LOCAL_REGISTRY_ALIASES')
      .split(/[,\s]+/)
      .filter(Boolean),
    env,
    failAction: failAction === 'allow' ? 'ignore' : 'block',
    unknownHostAction: parseFirewallAction(
      value('SFW_UNKNOWN_HOST_ACTION'),
      'SFW_UNKNOWN_HOST_ACTION',
      apiToken && apiToken !== 'sfw_free' ? 'block' : 'ignore',
    ),
    upstreamProxy,
    jsonReportPath: value('SFW_JSON_REPORT_PATH') || undefined,
    reportMessage: value('SFW_REPORT_MESSAGE') || undefined,
  }
}

export async function readFirewallHomeConfig(
  home: string,
): Promise<FirewallEnvironment> {
  let fileConfig: FirewallEnvironment = {}
  try {
    fileConfig = parseEnv(
      await readFile(path.join(home, '.sfw.config'), 'utf8'),
    )
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error
    }
  }
  return fileConfig
}

export function validateFirewallCaPaths(
  certificatePath?: string | undefined,
  keyPath?: string | undefined,
): void {
  if (Boolean(certificatePath) !== Boolean(keyPath)) {
    throw new Error(
      'Incomplete firewall CA configuration. SFW_CA_CERT_PATH and SFW_CA_KEY_PATH must name an existing pair. Set both variables or clear both.',
    )
  }
}

export function validateFirewallCommand(args: readonly string[]): void {
  if (!args.length || !args[0] || args[0].startsWith('-')) {
    throw new Error(
      'Invalid firewall command at socket sfw. Expected an executable followed by its arguments. Use socket sfw <command> [args]; service and registry modes are unavailable.',
    )
  }
}

export function validateFirewallFailAction(action: string): void {
  if (action && action !== 'allow' && action !== 'block') {
    throw new Error(
      'Invalid SFW_FAIL_ACTION in firewall configuration. Expected allow or block. Set a supported action.',
    )
  }
}

export function validateFirewallUpstreamProxy(
  value?: string | undefined,
): void {
  if (!value) {
    return
  }
  const parsed = new URL(value)
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.hash ||
    parsed.pathname !== '/' ||
    parsed.search
  ) {
    throw new Error(
      'Invalid SFW_UPSTREAM_PROXY in firewall configuration. Expected an HTTP or HTTPS proxy origin. Set a supported proxy URL.',
    )
  }
}
