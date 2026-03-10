import path from 'node:path'

import { handleOptimize } from './handle-optimize.mts'
import { CMD_NAME as CMD_NAME_FULL } from './shared.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { outputDryRunPreview } from '../../utils/dry-run/output.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/ecosystem/environment.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'
import type { DryRunAction } from '../../utils/dry-run/output.mts'

export const CMD_NAME = 'optimize'

const description = 'Optimize dependencies with @socketregistry overrides'

const hidden = false

export const cmdOptimize = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...commonFlags,
      pin: {
        type: 'boolean',
        default: false,
        description: 'Pin overrides to latest version',
      },
      prod: {
        type: 'boolean',
        default: false,
        description: 'Add overrides for production dependencies only',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} ./path/to/project --pin
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']

  const { json, markdown, pin, prod } = cli.flags

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const outputKind = getOutputKind(json, markdown)

  if (dryRun) {
    // Detect package environment to show meaningful dry-run output.
    const pkgEnvCResult = await detectAndValidatePackageEnvironment(cwd, {
      cmdName: CMD_NAME_FULL,
      prod: Boolean(prod),
    })

    if (!pkgEnvCResult.ok) {
      outputDryRunPreview({
        summary: 'Optimize dependencies with @socketregistry overrides',
        actions: [
          {
            type: 'fetch',
            description: 'Detect package environment',
            target: cwd,
          },
        ],
        wouldSucceed: false,
      })
      return
    }

    const pkgEnvDetails = pkgEnvCResult.data
    const { agent, agentVersion, pkgPath } = pkgEnvDetails

    const actions: DryRunAction[] = [
      {
        type: 'fetch',
        description: `Detected ${agent} v${agentVersion}`,
        target: pkgPath,
      },
      {
        type: 'fetch',
        description: 'Analyze dependencies against @socketregistry overrides',
        target: 'package.json and lockfile',
      },
      {
        type: 'modify',
        description: 'Add or update overrides section in package.json',
        target: path.join(pkgPath, 'package.json'),
        details: {
          pin: pin ? 'Yes - pin to specific versions' : 'No - use version ranges',
          prod: prod ? 'Yes - production dependencies only' : 'No - all dependencies',
        },
      },
      {
        type: 'execute',
        description: `Run ${agent} to install optimized dependencies`,
      },
    ]

    outputDryRunPreview({
      summary: `Optimize dependencies with @socketregistry overrides (${agent} v${agentVersion})`,
      actions,
      wouldSucceed: true,
    })
    return
  }

  await handleOptimize({
    cwd,
    pin: Boolean(pin),
    outputKind,
    prod: Boolean(prod),
  })
}
