/** @fileoverview Repository update output formatter for Socket CLI. Displays repository integration update results in JSON or text formats. Shows success confirmation or error messages. */

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputUpdateRepo(
  result: CResult<SocketSdkSuccessResult<'updateOrgRepo'>['data']>,
  repoName: string,
  outputKind: OutputKind,
): Promise<void> {
  outputResult(result, outputKind, {
    success: () => `Repository \`${repoName}\` updated successfully`,
  })
}
