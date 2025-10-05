/** @fileoverview Repository create output formatter for Socket CLI. Displays repository integration creation results in JSON or text formats. Shows repository name, default branch, and creation status. */

import { outputResult } from '../../utils/output.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export function outputCreateRepo(
  result: CResult<SocketSdkSuccessResult<'createOrgRepo'>['data']>,
  requestedName: string,
  outputKind: OutputKind,
): void {
  outputResult(result, outputKind, {
    success: data => {
      const { slug } = data
      return `OK. Repository created successfully, slug: \`${slug}\`${slug !== requestedName ? ' (Warning: slug is not the same as name that was requested!)' : ''}`
    },
  })
}
