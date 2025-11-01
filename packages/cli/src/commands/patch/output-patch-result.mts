import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'

import { OUTPUT_JSON } from '../../constants/cli.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { CResult, OutputKind } from '../../types.mts'

export async function outputPatchResult(
  result: CResult<{ patched: string[] }>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === OUTPUT_JSON) {
    getDefaultLogger().log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { patched } = result.data

  getDefaultLogger().log('')

  if (patched.length) {
    getDefaultLogger().group(
      `Successfully processed patches for ${patched.length} ${pluralize('package', { count: patched.length })}:`,
    )
    for (const pkg of patched) {
      getDefaultLogger().success(pkg)
    }
    getDefaultLogger().groupEnd()
  } else {
    getDefaultLogger().warn('No packages found requiring patches.')
  }

  getDefaultLogger().log('')
  getDefaultLogger().success('Patch command completed!')
}
