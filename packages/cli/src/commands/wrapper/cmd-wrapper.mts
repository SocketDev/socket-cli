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

const logger = getDefaultLogger()

const commandConfig = {
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

    While enabled, the wrapper makes it so that when you call npm/npx on your
    machine, it will automatically actually run \`socket npm\` / \`socket npx\`
    instead.

    Examples
      $ ${command} on
      $ ${command} off
  `,
  hidden: false,
}

export const cmdWrapper = {
  description: commandConfig.description,
  hidden: commandConfig.hidden,
  run,
}

export interface WrapperUpdateResult {
  modifiedFiles: string[]
  skippedFiles: string[]
}

export async function applyWrapperUpdate(
  files: string[],
  config: { enable: boolean },
): Promise<WrapperUpdateResult> {
  const { enable } = { __proto__: null, ...config } as typeof config
  const modifiedFiles: string[] = []
  const skippedFiles: string[] = []
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    if (enable && checkSocketWrapperSetup(file)) {
      skippedFiles.push(file)
      continue
    }
    if (enable) {
      await addSocketWrapper(file)
    } else {
      removeSocketWrapper(file)
    }
    modifiedFiles.push(file)
  }
  return { __proto__: null, modifiedFiles, skippedFiles }
}

export function outputWrapperResult(
  result: WrapperUpdateResult,
  config: { enable: boolean; outputKind: ReturnType<typeof getOutputKind> },
): void {
  const { enable, outputKind } = { __proto__: null, ...config } as typeof config
  const { modifiedFiles, skippedFiles } = result
  if (outputKind === 'json') {
    logger.log(
      JSON.stringify(
        {
          __proto__: null,
          action: enable ? 'enabled' : 'disabled',
          modifiedFiles,
          skippedFiles,
          success: modifiedFiles.length > 0 || skippedFiles.length > 0,
        },
        null,
        2,
      ),
    )
    return
  }
  if (outputKind !== 'markdown') {
    return
  }
  const arr: string[] = [
    `# Socket Wrapper ${enable ? 'Enabled' : 'Disabled'}`,
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
    `Socket npm/npx wrapper has been **${enable ? 'enabled' : 'disabled'}**.`,
    '',
  )
  logger.log(arr.join('\n'))
}

export function parseWrapperAction(
  arg: string | undefined,
): boolean | undefined {
  if (arg === 'enable' || arg === 'enabled' || arg === 'on') {
    return true
  }
  if (arg === 'disable' || arg === 'disabled' || arg === 'off') {
    return false
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
    config: commandConfig,
    importMeta,
    parentName,
  })

  // Feature request: Implement json/markdown output for wrapper command status.
  const { json, markdown } = cli.flags

  const dryRun = cli.flags['dryRun']

  const { 0: arg } = cli.input
  const enable = parseWrapperAction(arg)

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: enable !== undefined,
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
  if (!wasValidInput || enable === undefined) {
    return
  }

  const files = [getBashRcPath(), getZshRcPath()].filter(file =>
    existsSync(file),
  )

  if (dryRun) {
    writeWrapperDryRun(files, { enable })
    return
  }
  if (!files.length) {
    logger.fail('There was an issue setting up the alias in your bash profile')
    return
  }
  outputWrapperResult(await applyWrapperUpdate(files, { enable }), {
    enable,
    outputKind,
  })
}

export function writeWrapperDryRun(
  files: string[],
  config: { enable: boolean },
): void {
  const { enable } = { __proto__: null, ...config } as typeof config
  outputDryRunWrite(
    files.join(', '),
    enable
      ? 'enable Socket npm/pnpm exec wrapper'
      : 'disable Socket npm/pnpm exec wrapper',
    enable
      ? [
          'Add shell aliases/functions to wrap npm/pnpm exec commands',
          'Redirect npm/pnpm exec calls to socket npm/socket npx',
        ]
      : [
          'Remove Socket wrapper aliases/functions from shell config',
          'Restore original npm/pnpm exec behavior',
        ],
  )
}
