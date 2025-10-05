/** @fileoverview Repository delete output formatter for Socket CLI. Displays repository integration deletion results in JSON or text formats. Shows success confirmation or error messages. */

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputDeleteRepo(
  result: CResult<SocketSdkSuccessResult<'deleteOrgRepo'>['data']>,
  repoName: string,
  outputKind: OutputKind,
): Promise<void> {
  outputResult(result, outputKind, {
    success: () => `OK. Repository \`${repoName}\` deleted successfully`,
  })
}
