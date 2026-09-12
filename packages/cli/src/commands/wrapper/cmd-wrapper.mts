// product feature name / command wrapping npx; the literal is intentional.
/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-npx-dlx -- intentional literal */

import { existsSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { addSocketWrapper } from './add-socket-wrapper.mts'
import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.mts'
import { postinstallWrapper } from './postinstall-wrapper.mts'
import { removeSocketWrapper } from './remove-socket-wrapper.mts'
import { outputDryRunWrite } from '../../util/dry-run/output.mts'
import { getBashRcPath, getZshRcPath } from '../../constants/paths.mjs'
import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'
import type { OutputKind } from '../../types.mts'

const logger = getDefaultLogger()

const config = {
  commandName: 'wrapper',
  description: 'Enable or disable the Socket npm/pnpm exec wrapper',
  flags: defineFlags({
    ...commonFlags,
  }),
  help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} <"on" | "off">

    Options
      ${getFlagListOutput(helpConfig.flags)}

    While enabled, package manager commands run through Socket automatically.

    Examples
      $ ${command} on
      $ ${command} off
  `,
  hidden: false,
}

export const cmdWrapper = {
  description: config.description,
  hidden: config.hidden,
  run,
}

export async function applySocketWrapper(
  action: 'disable' | 'enable',
  files: readonly string[],
): Promise<{ modifiedFiles: string[]; skippedFiles: string[] }> {
  const modifiedFiles: string[] = []
  const skippedFiles: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (action === 'enable') {
      if (checkSocketWrapperSetup(file)) {
        skippedFiles.push(file)
      } else {
        await addSocketWrapper(file)
        modifiedFiles.push(file)
      }
    } else {
      removeSocketWrapper(file)
      modifiedFiles.push(file)
    }
  }
  return { modifiedFiles, skippedFiles }
}

export function getWrapperFiles(): string[] {
  return [getBashRcPath(), getZshRcPath()].filter(file => existsSync(file))
}

export function outputWrapperDryRun(
  action: 'disable' | 'enable',
  files: readonly string[],
): void {
  const changes =
    action === 'enable'
      ? [
          'Add shell aliases/functions to wrap npm/pnpm exec commands',
          'Redirect package manager execution through Socket',
        ]
      : [
          'Remove Socket wrapper aliases/functions from shell config',
          'Restore original npm/pnpm exec behavior',
        ]
  outputDryRunWrite(
    files.join(', '),
    `${action} Socket npm/pnpm exec wrapper`,
    changes,
  )
}

export function outputWrapperResult(
  action: 'disable' | 'enable',
  outputKind: OutputKind,
  modifiedFiles: readonly string[],
  skippedFiles: readonly string[],
): void {
  if (outputKind === 'json') {
    const result = {
      action: action === 'enable' ? 'enabled' : 'disabled',
      modifiedFiles,
      skippedFiles,
      success: modifiedFiles.length > 0 || skippedFiles.length > 0,
    }
    logger.log(JSON.stringify(result, null, 2))
    return
  }
  if (outputKind !== 'markdown') {
    return
  }
  const arr = [
    `# Socket Wrapper ${action === 'enable' ? 'Enabled' : 'Disabled'}`,
    '',
  ]
  if (modifiedFiles.length > 0) {
    arr.push('## Modified Files', '')
    for (let i = 0, { length } = modifiedFiles; i < length; i += 1) {
      arr.push(`- \`${modifiedFiles[i]}\``)
    }
    arr.push('')
  }
  if (skippedFiles.length > 0) {
    arr.push('## Skipped Files (already configured)', '')
    for (let i = 0, { length } = skippedFiles; i < length; i += 1) {
      arr.push(`- \`${skippedFiles[i]}\``)
    }
    arr.push('')
  }
  arr.push(
    '## Status',
    '',
    `Socket npm/npx wrapper has been **${action === 'enable' ? 'enabled' : 'disabled'}**.`,
    '',
  )
  logger.log(arr.join('\n'))
}

export function resolveWrapperAction(
  arg: string | undefined,
): 'disable' | 'enable' | undefined {
  if (arg === 'enable' || arg === 'enabled' || arg === 'on') {
    return 'enable'
  }
  if (arg === 'disable' || arg === 'disabled' || arg === 'off') {
    return 'disable'
  }
  return undefined
}

export async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  // I don't think meow would mess with this but ...
  if (argv[0] === '--postinstall') {
    await postinstallWrapper()
    return
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  // Feature request: Implement json/markdown output for wrapper command status.
  const { json, markdown } = cli.flags

  const dryRun = cli.flags['dryRun']

  const { 0: arg } = cli.input
  const action = resolveWrapperAction(arg)

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: action !== undefined,
      message: 'Must specify "on" or "off" argument',
      fail: 'missing',
    },
    {
      nook: true,
      test: cli.input.length <= 1,
      message: 'expecting exactly one argument',
      fail: 'got multiple',
    },
  )
  if (!wasValidInput) {
    return
  }

  const resolvedAction = action!

  const files = getWrapperFiles()

  if (dryRun) {
    outputWrapperDryRun(resolvedAction, files)
    return
  }
  const { modifiedFiles, skippedFiles } = await applySocketWrapper(
    resolvedAction,
    files,
  )

  if (files.length === 0) {
    logger.fail('There was an issue setting up the alias in your bash profile')
    return
  }

  outputWrapperResult(resolvedAction, outputKind, modifiedFiles, skippedFiles)
  // Text mode output is already handled by add/remove functions.
}
