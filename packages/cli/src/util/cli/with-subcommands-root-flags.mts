/**
 * Root-command flag visibility rules for the CLI sub-command router — the
 * root `socket` invocation surfaces a different flag set than a sub-command.
 *
 * Extracted from with-subcommands.mts to keep that file under the 1000-line
 * File size hard cap.
 */

import { isDebug } from '../debug.mts'

import type { MeowFlag, MeowFlags } from '../../flags.mts'

/**
 * Mutate `flags` in place so the root `socket` command shows its
 * root-only flags (compact-header, config, dry-run, help, version, ...) and
 * hides the per-command `json`/`markdown` flags, or the reverse for a
 * sub-command invocation.
 */
export function applyRootCommandFlagVisibility(
  flags: MeowFlags,
  options: { isRootCommand: boolean },
): void {
  const { isRootCommand } = { __proto__: null, ...options } as typeof options
  if (isRootCommand) {
    const hiddenDebugFlag = !isDebug()

    flags['compactHeader'] = {
      ...flags['compactHeader'],
      hidden: false,
    } as MeowFlag

    flags['config'] = {
      ...flags['config'],
      hidden: false,
    } as MeowFlag

    flags['dryRun'] = {
      ...flags['dryRun'],
      hidden: false,
    } as MeowFlag

    flags['help'] = {
      ...flags['help'],
      hidden: false,
    } as MeowFlag

    flags['helpFull'] = {
      ...flags['helpFull'],
      hidden: false,
    } as MeowFlag

    flags['maxOldSpaceSize'] = {
      ...flags['maxOldSpaceSize'],
      hidden: hiddenDebugFlag,
    } as MeowFlag

    flags['maxSemiSpaceSize'] = {
      ...flags['maxSemiSpaceSize'],
      hidden: hiddenDebugFlag,
    } as MeowFlag

    flags['version'] = {
      ...flags['version'],
      hidden: false,
    } as MeowFlag

    delete flags['json']
    delete flags['markdown']
  } else {
    delete flags['help']
    delete flags['helpFull']
    delete flags['version']
  }
}
