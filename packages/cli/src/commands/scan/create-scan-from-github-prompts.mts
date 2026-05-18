/**
 * Interactive prompts for `socket scan github`.
 *
 * Extracted from create-scan-from-github.mts to keep that file under the
 * 1000-line File-size cap. These helpers wrap @socketsecurity/lib prompt
 * primitives with a confirm-or-cancel CResult contract that the orchestration
 * code expects.
 */

import { confirm, select } from '@socketsecurity/lib/stdio/prompts'

import type { CResult } from '../../types.mts'

/**
 * Confirm a bulk action ("are you sure you want to run this for N repos?").
 */
export async function makeSure(count: number): Promise<CResult<undefined>> {
  if (
    !(await confirm({
      message: `Are you sure you want to run this for ${count} repos?`,
      default: false,
    }))
  ) {
    return {
      ok: false,
      message: 'User canceled',
      cause: 'Action canceled by user',
    }
  }
  return { ok: true, data: undefined }
}

/**
 * Ask the user to pick a single repo from a list. Returns ok:false with
 * cause='User chose to cancel the action' when the user picks the synthetic
 * '(Exit)' choice.
 */
export async function selectFocus(repos: string[]): Promise<CResult<string[]>> {
  const proceed = await select({
    message: 'Please select the repo to process:',
    choices: repos
      .map(slug => ({
        name: slug,
        value: slug,
        description: `Create scan for the ${slug} repo through GitHub`,
      }))
      .concat({
        name: '(Exit)',
        value: '',
        description: 'Cancel this action and exit',
      }),
  })
  if (!proceed) {
    return {
      ok: false,
      message: 'Canceled by user',
      cause: 'User chose to cancel the action',
    }
  }
  return { ok: true, data: [proceed] }
}
