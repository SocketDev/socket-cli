import type { CResult } from '../../types.mts'

export async function scanReachability(cwd: string): Promise<CResult<unknown>> {
  console.log('Scannig now... as soon as you implement me! From', cwd)

  return { ok: true, data: undefined }
}
