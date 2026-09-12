import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import {
  getDefaultFormatting,
  stringifyWithFormatting,
} from '@socketsecurity/lib-stable/json/format'

import { getDefaultApiToken } from '../../util/socket/sdk.mts'
import {
  applyMachineModeIfActive,
  inferSubcommand,
} from '../../util/spawn/apply-machine-mode.mts'
import {
  buildSystemToolEnv,
  describeSystemToolFailure,
} from '../../util/spawn/system-tool.mts'
import {
  ensureFirewallCertificateAuthority,
  loadFirewallCertificateAuthority,
} from './certificates.mts'
import { spawnFirewallChild } from './child.mts'
import { resolveFirewallExecutable } from './executable.mts'
import { readFirewallConfig, validateFirewallCommand } from './config.mts'
import {
  buildFirewallChildEnvironment,
  createFirewallTrustBundle,
} from './environment.mts'
import { createFirewallPolicy } from './policy/index.mts'
import { startFirewallProxy } from './proxy.mts'
import { startFirewallRegistryRebind } from './rebind.mts'
import { createFirewallReport } from './report.mts'

import type { StdioOptions } from 'node:child_process'
import type { FirewallChildResult } from './child.mts'
import type { FirewallEnvironment } from './environment.mts'

export interface FirewallRunOptions {
  cwd?: string | undefined
  env?: FirewallEnvironment | undefined
  stdio?: StdioOptions | undefined
  signal?: AbortSignal | undefined
}

const logger = getDefaultLogger()

export async function runFirewallCommand(
  args: readonly string[],
  options: FirewallRunOptions = {},
): Promise<FirewallChildResult> {
  validateFirewallCommand(args)
  options.signal?.throwIfAborted()
  const config = await readFirewallConfig({
    env: options.env,
    apiToken: getDefaultApiToken(),
  })
  const [command, ...commandArgs] = args
  const resolution = await resolveFirewallExecutable(command!, {
    cwd: options.cwd,
    env: config.env,
  })
  if (!resolution) {
    throw new Error(
      await describeSystemToolFailure(command!, { cwd: options.cwd }),
    )
  }
  const paths =
    config.certificatePath && config.keyPath
      ? { certificatePath: config.certificatePath, keyPath: config.keyPath }
      : await ensureFirewallCertificateAuthority({
          directory: config.caDirectory,
        })
  const authority = await loadFirewallCertificateAuthority(paths)
  const trust = await createFirewallTrustBundle({
    certificate: authority.certificate,
    env: config.env,
  })
  const events = createFirewallReport()
  let policy: ReturnType<typeof createFirewallPolicy> | undefined
  let proxy: Awaited<ReturnType<typeof startFirewallProxy>> | undefined
  let result: FirewallChildResult | undefined
  let rebind: Awaited<ReturnType<typeof startFirewallRegistryRebind>> =
    undefined
  try {
    const activePolicy = createFirewallPolicy({
      apiToken: config.apiToken,
      customRegistries: config.customRegistries,
      localRegistryAliases: config.localRegistryAliases,
      failAction: config.failAction,
      unknownHostAction: config.unknownHostAction,
      upstreamProxy: config.upstreamProxy,
      upstreamCa: trust.certificates,
      onWarning(message) {
        logger.error(`Socket Firewall: ${message}`)
      },
      onDecision(purl, decision) {
        if (config.jsonReportPath) {
          events.record(purl, decision)
        }
        if (decision.blocked) {
          logger.error(`Socket Firewall blocked ${purl}.`)
        }
      },
    })
    policy = activePolicy
    proxy = await startFirewallProxy({
      certificateAuthority: authority,
      checkRequest: (...requestArgs) =>
        activePolicy.checkRequest(...requestArgs),
      resolveDestination: (...destinationArgs) =>
        activePolicy.resolveDestination(...destinationArgs),
      upstreamCa: trust.certificates,
      upstreamProxy: config.upstreamProxy,
      onRequestError(diagnostic) {
        logger.error(`Socket Firewall request failed: ${diagnostic}`)
      },
    })
    const applied = applyMachineModeIfActive({
      args: commandArgs,
      env: config.env,
      subcommand: inferSubcommand(commandArgs),
      tool: command!,
    })
    const env = buildFirewallChildEnvironment({
      env: buildSystemToolEnv(
        { ...config.env, ...applied.env },
        resolution.searchPath,
      ),
      proxyUrl: proxy.url,
      certificatePath: trust.certificatePath,
    })
    rebind = await startFirewallRegistryRebind({
      command: command!,
      args: applied.args,
      cwd: options.cwd,
      env,
      proxyUrl: proxy.url,
      certificate: authority.certificate,
    })
    result = await spawnFirewallChild({
      executable: resolution.executable,
      args: [...resolution.prefixArgs, ...(rebind?.args ?? applied.args)],
      cwd: options.cwd,
      env,
      stdio: options.stdio,
      signal: options.signal,
    })
  } finally {
    try {
      policy?.close()
    } finally {
      try {
        await rebind?.close()
      } finally {
        try {
          await proxy?.close()
        } finally {
          await trust.close()
        }
      }
    }
  }
  if (config.jsonReportPath) {
    const report = await open(
      config.jsonReportPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await report.writeFile(
        stringifyWithFormatting(
          {
            command,
            code: result.code,
            signal: result.signal,
            message: config.reportMessage,
            ...events.snapshot(),
            tunneledEcosystems: policy?.getTunneledEcosystems(),
          },
          getDefaultFormatting(),
        ),
      )
    } finally {
      await report.close()
    }
  } else if (config.reportMessage) {
    logger.error(config.reportMessage)
  }
  return result
}
