/** @fileoverview Scan deletion output formatter for Socket CLI. Displays scan deletion results in JSON or text formats. Shows success confirmation or error messages. */

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export async function outputDeleteScan(
  result: CResult<SocketSdkSuccessResult<'deleteOrgFullScan'>['data']>,
  outputKind: OutputKind,
): Promise<void> {
  outputResult(result, outputKind, {
    success: () => 'Scan deleted successfully',
  })
}
